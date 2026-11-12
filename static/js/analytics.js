"use strict";

const analyticsPeriod = document.querySelector("#analyticsPeriod");
const chartType = document.querySelector("#chartType");
const chartMeasure = document.querySelector("#chartMeasure");
const chartCurrency = document.querySelector("#chartCurrency");
const currencyControl = document.querySelector("#currencyControl");
const analyticsFrom = document.querySelector("#analyticsFrom");
const analyticsTo = document.querySelector("#analyticsTo");
const analyticsError = document.querySelector("#analyticsError");
if (window.payplusPreferences) {
	chartType.value = window.payplusPreferences.get().chartType;
}
let currentAnalytics;
let customDateRange = false;
let activeAnalyticsRequest;

function formatAnalyticsCurrency(amount, currency) {
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency,
			maximumFractionDigits: 2,
		}).format(amount);
	} catch {
		return `${currency} ${Number(amount).toFixed(2)}`;
	}
}

function formatAnalyticsDate(value, options = {}) {
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}
	return new Intl.DateTimeFormat(undefined, {
		timeZone: "UTC",
		month: "short",
		day: "numeric",
		year: options.year ? "numeric" : undefined,
	}).format(parsed);
}

function formatBucketLabel(value, period) {
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}
	const options = period === "monthly"
		? { month: "short", year: "2-digit", timeZone: "UTC" }
		: { month: "short", day: "numeric", timeZone: "UTC" };
	const label = new Intl.DateTimeFormat(undefined, options).format(parsed);
	return period === "weekly" ? `Week of ${label}` : label;
}

function createAnalyticsSvg(name, attributes = {}) {
	const element = document.createElementNS("http://www.w3.org/2000/svg", name);
	for (const [attribute, value] of Object.entries(attributes)) {
		element.setAttribute(attribute, String(value));
	}
	return element;
}

function renderCurrencySummary(volumes) {
	const container = document.querySelector("#volumeSummary");
	container.replaceChildren();
	if (!volumes.length) {
		const value = document.createElement("span");
		value.className = "metric-value";
		value.textContent = "—";
		container.append(value);
		return;
	}
	for (const item of volumes) {
		const row = document.createElement("span");
		row.className = "currency-total-row";
		const currency = document.createElement("span");
		currency.className = "currency-code";
		currency.textContent = item.currency;
		const amount = document.createElement("strong");
		amount.textContent = formatAnalyticsCurrency(item.amount, item.currency);
		row.append(currency, amount);
		container.append(row);
	}
}

function renderComparisons(data) {
	const comparison = data.comparison;
	const countValue = document.querySelector("#countComparison");
	const note = document.querySelector("#comparisonNote");
	if (comparison.transaction_count_change_percent === null) {
		countValue.textContent = "—";
		note.textContent = "No prior-period records for comparison";
	} else {
		const change = comparison.transaction_count_change;
		const sign = change > 0 ? "+" : "";
		countValue.textContent = `${sign}${change} (${sign}${comparison.transaction_count_change_percent.toFixed(1)}%)`;
		note.textContent = "Change in transaction count from the prior range";
	}

	const comparisonList = document.querySelector("#currencyComparison");
	comparisonList.replaceChildren();
	document.querySelector("#previousRangeLabel").textContent =
		`Previous range: ${formatAnalyticsDate(data.previous_period.date_from, { year: true })} to ${formatAnalyticsDate(data.previous_period.date_to, { year: true })}`;
	if (!comparison.volume_by_currency.length) {
		const empty = document.createElement("p");
		empty.className = "breakdown-empty";
		empty.textContent = "No transaction volume to compare in either period.";
		comparisonList.append(empty);
		return;
	}
	for (const item of comparison.volume_by_currency) {
		const row = document.createElement("div");
		row.className = "comparison-row";
		const code = document.createElement("strong");
		code.textContent = item.currency;
		const current = document.createElement("span");
		current.textContent = `Current ${formatAnalyticsCurrency(item.current_amount, item.currency)}`;
		const previous = document.createElement("span");
		previous.textContent = `Previous ${formatAnalyticsCurrency(item.previous_amount, item.currency)}`;
		const change = document.createElement("span");
		change.textContent = item.change_percent === null
			? `Change ${formatAnalyticsCurrency(item.change_amount, item.currency)} (no prior total)`
			: `Change ${item.change_amount > 0 ? "+" : ""}${formatAnalyticsCurrency(item.change_amount, item.currency)} (${item.change_percent > 0 ? "+" : ""}${item.change_percent.toFixed(1)}%)`;
		row.append(code, current, previous, change);
		comparisonList.append(row);
	}
}

function renderCategories(categoryData) {
	const container = document.querySelector("#categoryBreakdown");
	container.replaceChildren();
	if (!categoryData.available) {
		const empty = document.createElement("p");
		empty.className = "breakdown-empty";
		empty.textContent = "Category details are not stored for these records.";
		container.append(empty);
		return;
	}
	if (!categoryData.items.length) {
		const empty = document.createElement("p");
		empty.className = "breakdown-empty";
		empty.textContent = "No category totals in this date range.";
		container.append(empty);
		return;
	}
	for (const item of categoryData.items) {
		const row = document.createElement("div");
		row.className = "category-breakdown-row";
		const category = document.createElement("span");
		category.className = "category-name";
		category.textContent = item.category;
		const count = document.createElement("span");
		count.textContent = `${item.transaction_count} ${item.transaction_count === 1 ? "record" : "records"}`;
		const amount = document.createElement("strong");
		amount.textContent = `${item.currency} ${formatAnalyticsCurrency(item.amount, item.currency)}`;
		row.append(category, count, amount);
		container.append(row);
	}
}

function renderStatuses(statusData) {
	const container = document.querySelector("#statusBreakdown");
	container.replaceChildren();
	if (!statusData.available) {
		const title = document.createElement("strong");
		title.textContent = "Status is not stored";
		const message = document.createElement("p");
		message.textContent = "The current transaction table has no payment-status field, so successful and failed counts cannot be calculated.";
		container.append(title, message);
		return;
	}
	if (!statusData.items.length) {
		const empty = document.createElement("p");
		empty.className = "breakdown-empty";
		empty.textContent = "No status values are available in this date range.";
		container.append(empty);
		return;
	}
	for (const item of statusData.items) {
		const row = document.createElement("div");
		row.className = "status-breakdown-row";
		const label = document.createElement("span");
		label.textContent = item.status || "Unspecified";
		const count = document.createElement("strong");
		count.textContent = new Intl.NumberFormat().format(item.transaction_count);
		row.append(label, count);
		container.append(row);
	}
}

function selectedCurrency() {
	return chartCurrency.value || currentAnalytics?.volume_by_currency[0]?.currency || "";
}

function renderActivityChart(data) {
	const chart = document.querySelector("#analyticsChart");
	const emptyState = document.querySelector("#analyticsChartEmpty");
	chart.replaceChildren();
	const hasActivity = data.activity.some((bucket) => bucket.transaction_count > 0);
	if (!hasActivity) {
		chart.hidden = true;
		emptyState.hidden = false;
		return;
	}
	chart.hidden = false;
	emptyState.hidden = true;

	const measure = chartMeasure.value;
	const currency = selectedCurrency();
	const values = data.activity.map((bucket) => {
		if (measure === "count") {
			return bucket.transaction_count;
		}
		return bucket.volume_by_currency.find((item) => item.currency === currency)?.amount || 0;
	});
	const minimum = Math.min(0, ...values);
	const maximum = Math.max(1, ...values);
	const chartBox = { left: 62, right: 744, top: 24, bottom: 246 };
	const chartHeight = chartBox.bottom - chartBox.top;
	const chartWidth = chartBox.right - chartBox.left;
	const baseline = chartBox.bottom - ((0 - minimum) / (maximum - minimum)) * chartHeight;
	const points = values.map((value, index) => ({
		x: data.activity.length === 1
			? chartBox.left + chartWidth / 2
			: chartBox.left + (index * chartWidth) / (data.activity.length - 1),
		y: chartBox.bottom - ((value - minimum) / (maximum - minimum)) * chartHeight,
		value,
		label: formatBucketLabel(data.activity[index].period_start, data.period),
		count: data.activity[index].transaction_count,
	}));
	const middle = (minimum + maximum) / 2;
	const tickValues = [...new Set([minimum, middle, maximum])];
	for (const tick of tickValues) {
		const y = chartBox.bottom - ((tick - minimum) / (maximum - minimum)) * chartHeight;
		chart.append(createAnalyticsSvg("line", {
			x1: chartBox.left,
			x2: chartBox.right,
			y1: y,
			y2: y,
			class: "analytics-gridline",
		}));
		const label = createAnalyticsSvg("text", {
			x: chartBox.left - 10,
			y: y + 4,
			class: "analytics-axis-label",
			"text-anchor": "end",
		});
		label.textContent = measure === "count"
			? new Intl.NumberFormat().format(Math.round(tick))
			: formatAnalyticsCurrency(tick, currency || "USD");
		chart.append(label);
	}

	if (chartType.value === "bar") {
		const slot = chartWidth / Math.max(points.length, 1);
		const barWidth = Math.min(34, slot * 0.62);
		for (const point of points) {
			const bar = createAnalyticsSvg("rect", {
				x: point.x - barWidth / 2,
				y: Math.min(point.y, baseline),
				width: barWidth,
				height: Math.max(1, Math.abs(baseline - point.y)),
				rx: 4,
				class: "analytics-bar",
			});
			const title = createAnalyticsSvg("title");
			title.textContent = measure === "count"
				? `${point.label}: ${point.count} transactions`
				: `${point.label}: ${formatAnalyticsCurrency(point.value, currency)}`;
			bar.append(title);
			chart.append(bar);
		}
	} else {
		const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
		if (chartType.value === "area") {
			const area = createAnalyticsSvg("path", {
				d: `${linePath} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`,
				class: "analytics-area",
			});
			chart.append(area);
		}
		chart.append(createAnalyticsSvg("path", { d: linePath, class: "analytics-line" }));
		for (const point of points) {
			const marker = createAnalyticsSvg("circle", {
				cx: point.x,
				cy: point.y,
				r: 3.5,
				class: "analytics-point",
			});
			const title = createAnalyticsSvg("title");
			title.textContent = measure === "count"
				? `${point.label}: ${point.count} transactions`
				: `${point.label}: ${formatAnalyticsCurrency(point.value, currency)}`;
			marker.append(title);
			chart.append(marker);
		}
	}

	const labelStep = Math.max(1, Math.ceil(points.length / 7));
	points.forEach((point, index) => {
		if (index % labelStep !== 0 && index !== points.length - 1) {
			return;
		}
		const label = createAnalyticsSvg("text", {
			x: point.x,
			y: 272,
			class: "analytics-axis-label",
			"text-anchor": "middle",
		});
		label.textContent = point.label;
		chart.append(label);
	});
	const yTitle = createAnalyticsSvg("text", {
		x: 12,
		y: 135,
		class: "analytics-axis-title",
		transform: "rotate(-90 12 135)",
	});
	yTitle.textContent = measure === "count" ? "Transactions" : currency;
	chart.append(yTitle);
}

function renderAnalytics(data) {
	currentAnalytics = data;
	if (!analyticsFrom.value) {
		analyticsFrom.value = data.date_from;
	}
	if (!analyticsTo.value) {
		analyticsTo.value = data.date_to;
	}
	document.querySelector("#analyticsCount").textContent = new Intl.NumberFormat().format(data.transaction_count);
	document.querySelector("#analyticsRangeLabel").textContent = `${formatAnalyticsDate(data.date_from, { year: true })} to ${formatAnalyticsDate(data.date_to, { year: true })}`;
	document.querySelector("#chartRangeBadge").textContent = data.period.toUpperCase();
	document.querySelector("#chartDescription").textContent = `Recorded ${data.period} activity for the selected range`;
	document.querySelector("#categoryCount").textContent = data.category_breakdown.available
		? new Set(data.category_breakdown.items.map((item) => item.category)).size
		: "—";
	renderCurrencySummary(data.volume_by_currency);
	renderComparisons(data);
	renderCategories(data.category_breakdown);
	renderStatuses(data.status_breakdown);

	const availableCurrencies = data.volume_by_currency.map((item) => item.currency);
	const oldCurrency = chartCurrency.value;
	chartCurrency.replaceChildren(...availableCurrencies.map((currency) => new Option(currency, currency)));
	chartCurrency.disabled = availableCurrencies.length === 0;
	if (availableCurrencies.includes(oldCurrency)) {
		chartCurrency.value = oldCurrency;
	}
	currencyControl.hidden = chartMeasure.value !== "volume";
	document.querySelector("#chartLegendLabel").textContent = chartMeasure.value === "count"
		? "Recorded transactions"
		: `${selectedCurrency() || "No currency"} recorded volume`;
	renderActivityChart(data);
	analyticsError.hidden = true;
}

async function loadAnalytics() {
	activeAnalyticsRequest?.abort();
	const controller = new AbortController();
	activeAnalyticsRequest = controller;
	const parameters = new URLSearchParams({ period: analyticsPeriod.value });
	if (analyticsFrom.value) {
		parameters.set("date_from", analyticsFrom.value);
	}
	if (analyticsTo.value) {
		parameters.set("date_to", analyticsTo.value);
	}
	analyticsError.hidden = true;
	try {
		const response = await fetch(`/api/analytics?${parameters}`, {
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || "Analytics could not be loaded.");
		}
		renderAnalytics(payload.data);
	} catch (error) {
		if (error.name === "AbortError") {
			return;
		}
		console.error("Could not load analytics.", error);
		analyticsError.textContent = error.message || "Analytics could not be loaded. Please try again.";
		analyticsError.hidden = false;
	}
}

analyticsPeriod.addEventListener("change", () => {
	if (!customDateRange) {
		analyticsFrom.value = "";
		analyticsTo.value = "";
	}
	loadAnalytics();
});

for (const input of [analyticsFrom, analyticsTo]) {
	input.addEventListener("change", () => {
		customDateRange = true;
	});
}

document.querySelector("#applyAnalytics").addEventListener("click", () => {
	customDateRange = Boolean(analyticsFrom.value || analyticsTo.value);
	loadAnalytics();
});

document.querySelector("#clearAnalyticsRange").addEventListener("click", () => {
	customDateRange = false;
	analyticsPeriod.value = "monthly";
	analyticsFrom.value = "";
	analyticsTo.value = "";
	loadAnalytics();
});

chartType.addEventListener("change", () => {
	window.payplusPreferences?.save({ chartType: chartType.value });
	if (currentAnalytics) {
		renderActivityChart(currentAnalytics);
	}
});
chartMeasure.addEventListener("change", () => currentAnalytics && renderAnalytics(currentAnalytics));
chartCurrency.addEventListener("change", () => currentAnalytics && renderActivityChart(currentAnalytics));

loadAnalytics();