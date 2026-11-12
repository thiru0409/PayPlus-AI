"use strict";

const appShell = document.querySelector("#appShell");
const sidebar = document.querySelector("#sidebar");
const sidebarBackdrop = document.querySelector("#sidebarBackdrop");
const menuToggle = document.querySelector("#menuToggle");
const collapseToggle = document.querySelector("#collapseToggle");
const notificationToggle = document.querySelector("#notificationToggle");
const notificationPanel = document.querySelector("#notificationPanel");

const numberFormatter = new Intl.NumberFormat(undefined, {
	maximumFractionDigits: 0,
});
let currentDashboardSummary;

function formatCurrency(amount, currency) {
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency,
			maximumFractionDigits: 2,
		}).format(amount);
	} catch {
		return `${currency} ${amount.toFixed(2)}`;
	}
}

function formatDate(value) {
	const date = new Date(`${value}T00:00:00`);
	if (Number.isNaN(date.getTime())) {
		return value || "Date unavailable";
	}
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

function setCurrentDate() {
	const today = new Date();
	const label = document.querySelector("#todayLabel");
	label.dateTime = today.toISOString().slice(0, 10);
	label.textContent = new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(today);
}

function createSvgElement(name, attributes = {}) {
	const element = document.createElementNS("http://www.w3.org/2000/svg", name);
	for (const [attribute, value] of Object.entries(attributes)) {
		element.setAttribute(attribute, String(value));
	}
	return element;
}

function renderMonthlyChart(activity) {
	const chart = document.querySelector("#monthlyChart");
	const emptyState = document.querySelector("#chartEmpty");
	chart.replaceChildren();

	if (!activity.some((month) => month.count > 0)) {
		chart.hidden = true;
		emptyState.hidden = false;
		return;
	}

	chart.hidden = false;
	emptyState.hidden = true;
	const left = 43;
	const right = 706;
	const top = 18;
	const bottom = 181;
	const plotHeight = bottom - top;
	const bandWidth = (right - left) / activity.length;
	const maximum = Math.max(...activity.map((month) => month.count), 4);
	const chartType = window.payplusPreferences?.get().chartType || "bar";
	const tickValues = [...new Set([0, Math.ceil(maximum / 2), maximum])];

	for (const tick of tickValues) {
		const y = bottom - (tick / maximum) * plotHeight;
		chart.append(
			createSvgElement("line", {
				x1: left,
				x2: right,
				y1: y,
				y2: y,
				class: "chart-gridline",
			}),
		);
		const label = createSvgElement("text", {
			x: 5,
			y: y + 3,
			class: "chart-tick",
		});
		label.textContent = numberFormatter.format(tick);
		chart.append(label);
	}

	const points = activity.map((month, index) => ({
		x: left + bandWidth * (index + 0.5),
		y: bottom - (month.count / maximum) * plotHeight,
		month,
		label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(
			new Date(`${month.month}-01T00:00:00`),
		),
	}));
	if (chartType === "line" || chartType === "area") {
		const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
		if (chartType === "area") {
			chart.append(createSvgElement("path", {
				d: `${linePath} L${points[points.length - 1].x},${bottom} L${points[0].x},${bottom} Z`,
				class: "chart-area-fill",
			}));
		}
		chart.append(createSvgElement("path", { d: linePath, class: "chart-line" }));
	}
	for (const point of points) {
		const { month, x: center, y, label: monthLabel } = point;
		if (chartType === "bar") {
			const barHeight = month.count ? (month.count / maximum) * plotHeight : 1;
			const barWidth = Math.min(42, bandWidth * 0.42);
			const bar = createSvgElement("rect", {
				x: center - barWidth / 2,
				y: bottom - barHeight,
				width: barWidth,
				height: barHeight,
				rx: 4,
				class: "chart-bar",
			});
			const title = createSvgElement("title");
			title.textContent = `${monthLabel}: ${month.count} ${month.count === 1 ? "transaction" : "transactions"}`;
			bar.append(title);
			chart.append(bar);
		} else {
			const pointMark = createSvgElement("circle", {
				cx: center,
				cy: y,
				r: 3.5,
				class: "chart-point",
			});
			const title = createSvgElement("title");
			title.textContent = `${monthLabel}: ${month.count} ${month.count === 1 ? "transaction" : "transactions"}`;
			pointMark.append(title);
			chart.append(pointMark);
		}
		const label = createSvgElement("text", {
			x: center,
			y: 208,
			class: "chart-tick",
			"text-anchor": "middle",
		});
		label.textContent = monthLabel;
		chart.append(label);
	}
}

function createTransactionRow(transaction) {
	const row = document.createElement("div");
	row.className = "transaction-row";
	row.setAttribute("role", "row");

	const primaryCell = document.createElement("div");
	primaryCell.className = "transaction-cell transaction-primary";
	primaryCell.setAttribute("role", "cell");
	const mark = document.createElement("span");
	mark.className = "merchant-mark";
	mark.setAttribute("aria-hidden", "true");
	mark.textContent = (transaction.description || "T").trim().charAt(0).toUpperCase();
	const copy = document.createElement("span");
	copy.className = "merchant-copy";
	const description = document.createElement("span");
	description.className = "merchant-name";
	description.textContent = transaction.description || "Unnamed transaction";
	const identifier = document.createElement("span");
	identifier.className = "merchant-meta";
	identifier.textContent = `Record #${transaction.id}`;
	copy.append(description, identifier);
	primaryCell.append(mark, copy);

	const categoryCell = document.createElement("div");
	categoryCell.className = "transaction-cell";
	categoryCell.setAttribute("role", "cell");
	const category = document.createElement("span");
	category.className = "category-chip";
	category.textContent = transaction.category || "Uncategorized";
	categoryCell.append(category);

	const dateCell = document.createElement("div");
	dateCell.className = "transaction-cell";
	dateCell.setAttribute("role", "cell");
	dateCell.textContent = formatDate(transaction.transaction_date);

	const amountCell = document.createElement("div");
	amountCell.className = "transaction-cell";
	amountCell.setAttribute("role", "cell");
	amountCell.textContent = formatCurrency(transaction.amount, transaction.currency || "USD");

	row.append(primaryCell, categoryCell, dateCell, amountCell);
	return row;
}

function renderTransactions(transactions, totalCount) {
	const rows = document.querySelector("#recentRows");
	const tableEmpty = document.querySelector("#tableEmpty");
	const table = document.querySelector(".transaction-table");
	rows.replaceChildren(...transactions.map(createTransactionRow));
	document.querySelector("#recordCount").textContent = `${numberFormatter.format(totalCount)} ${totalCount === 1 ? "RECORD" : "RECORDS"}`;
	const hasRows = transactions.length > 0;
	table.hidden = !hasRows;
	tableEmpty.hidden = hasRows;
}

function renderSummary(summary) {
	currentDashboardSummary = summary;
	document.querySelector("#transactionCount").textContent = numberFormatter.format(summary.transaction_count);
	const volume = summary.volume_by_currency;
	const volumeValue = document.querySelector("#transactionVolume");
	const volumeNote = document.querySelector("#volumeNote");
	if (volume.length === 0) {
		volumeValue.textContent = "—";
		volumeNote.textContent = "No payment records yet";
	} else if (volume.length === 1) {
		volumeValue.textContent = formatCurrency(volume[0].amount, volume[0].currency);
		volumeNote.textContent = "Total recorded value in this currency";
	} else {
		volumeValue.textContent = `${volume.length} currencies`;
		volumeNote.textContent = "Currency totals are kept separate";
	}

	const updated = new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date());
	document.querySelector("#updatedLabel").textContent = `Updated ${updated}`;
	renderMonthlyChart(summary.monthly_activity);
	renderTransactions(summary.recent_transactions, summary.transaction_count);
}

async function loadSummary() {
	const errorBanner = document.querySelector("#loadError");
	const retryButton = document.querySelector("#retryButton");
	const refreshButton = document.querySelector("#refreshSummary");
	errorBanner.hidden = true;
	retryButton.disabled = true;
	if (refreshButton) {
		refreshButton.disabled = true;
	}
	try {
		const response = await fetch("/api/dashboard/summary", {
			headers: { Accept: "application/json" },
		});
		if (!response.ok) {
			throw new Error(`Dashboard request failed with status ${response.status}`);
		}
		const payload = await response.json();
		if (!payload.data || !Array.isArray(payload.data.monthly_activity)) {
			throw new Error("Dashboard response was not in the expected format");
		}
		renderSummary(payload.data);
	} catch (error) {
		console.error("Could not load the dashboard summary.", error);
		errorBanner.hidden = false;
		document.querySelector("#updatedLabel").textContent = "Summary unavailable";
	} finally {
		retryButton.disabled = false;
		if (refreshButton) {
			refreshButton.disabled = false;
		}
	}
}

function setMobileMenu(open) {
	appShell.classList.toggle("mobile-menu-open", open);
	menuToggle.setAttribute("aria-expanded", String(open));
	menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
	menuToggle.title = open ? "Close navigation" : "Open navigation";
	sidebarBackdrop.hidden = !open;
}

menuToggle.addEventListener("click", () => {
	setMobileMenu(!appShell.classList.contains("mobile-menu-open"));
});

sidebarBackdrop.addEventListener("click", () => setMobileMenu(false));

collapseToggle.addEventListener("click", () => {
	const collapsed = appShell.classList.toggle("is-collapsed");
	collapseToggle.setAttribute("aria-expanded", String(!collapsed));
	collapseToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
	collapseToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
});

notificationToggle.addEventListener("click", () => {
	const isOpen = notificationToggle.getAttribute("aria-expanded") === "true";
	notificationToggle.setAttribute("aria-expanded", String(!isOpen));
	notificationPanel.hidden = isOpen;
});

document.addEventListener("click", (event) => {
	if (!event.target.closest(".notification-wrap")) {
		notificationPanel.hidden = true;
		notificationToggle.setAttribute("aria-expanded", "false");
	}
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		setMobileMenu(false);
		notificationPanel.hidden = true;
		notificationToggle.setAttribute("aria-expanded", "false");
	}
});

document.querySelector("#retryButton")?.addEventListener("click", loadSummary);
document.querySelector("#refreshSummary")?.addEventListener("click", loadSummary);
setCurrentDate();
if (document.querySelector("#monthlyChart")) {
	loadSummary();
	document.addEventListener("payplus:preferences-applied", () => {
		if (currentDashboardSummary) {
			renderMonthlyChart(currentDashboardSummary.monthly_activity);
		}
	});
}
