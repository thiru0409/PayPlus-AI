"use strict";

const securityDialog = document.querySelector("#securityDetailsDialog");
const reviewRows = document.querySelector("#reviewRows");

function formatSecurityDate(value) {
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		return value || "Not available";
	}
	return new Intl.DateTimeFormat(undefined, {
		timeZone: "UTC",
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(parsed);
}

function formatSecurityAmount(amount, currency) {
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

function securityCell(row, value, label, className = "") {
	const cell = document.createElement("td");
	cell.dataset.label = label;
	if (className) {
		cell.className = className;
	}
	cell.textContent = value;
	row.append(cell);
	return cell;
}

function createReviewRow(transaction) {
	const row = document.createElement("tr");
	securityCell(row, `#${transaction.id}`, "ID");
	securityCell(row, transaction.description || "Unnamed transaction", "Description", "record-description");
	securityCell(row, formatSecurityDate(transaction.transaction_date), "Date");
	securityCell(row, formatSecurityAmount(transaction.amount, transaction.currency || "USD"), "Amount", "record-amount");
	const assessment = document.createElement("td");
	assessment.dataset.label = "Risk assessment";
	const scored = document.createElement("span");
	scored.className = `risk-unscored-label risk-${transaction.risk_level}`;
	scored.textContent = `${transaction.risk_level} · ${transaction.risk_score}/100`;
	assessment.append(scored);
	row.append(assessment);
	const details = document.createElement("td");
	details.dataset.label = "Details";
	const button = document.createElement("button");
	button.className = "details-button";
	button.type = "button";
	button.dataset.transactionId = String(transaction.id);
	button.textContent = "Review details";
	button.setAttribute("aria-label", `Review details for transaction ${transaction.id}`);
	details.append(button);
	row.append(details);
	return row;
}

function renderReviewTransactions(data) {
	document.querySelector("#riskTransactionCount").textContent = new Intl.NumberFormat().format(data.transaction_count);
	document.querySelector("#riskAlertCount").textContent = new Intl.NumberFormat().format(data.alert_count);
	document.querySelector("#reviewRecordCount").textContent = `${data.recent_transactions.length} RECENT`;
	reviewRows.replaceChildren(...data.recent_transactions.map(createReviewRow));
	const hasRecords = data.recent_transactions.length > 0;
	document.querySelector("#reviewTableWrap").hidden = !hasRecords;
	const empty = document.querySelector("#reviewEmpty");
	empty.hidden = hasRecords;
	if (!hasRecords) {
		document.querySelector("#reviewEmptyTitle").textContent = "No transaction records yet";
		document.querySelector("#reviewEmptyCopy").textContent = "Import a CSV or wait for a supported source. The local model will score saved records.";
	}
}

function showSecurityDetails(transaction) {
	const fields = [
		["Transaction ID", transaction.id],
		["Merchant / description", transaction.description],
		["Amount", formatSecurityAmount(transaction.amount, transaction.currency || "USD")],
		["Currency", transaction.currency],
		["Date", formatSecurityDate(transaction.transaction_date)],
		["Risk assessment", `${transaction.risk_level} (${transaction.risk_score}/100)`],
		["Model reasons", (transaction.risk_reasons || []).join("; ")],
		["Status", transaction.status || "Not stored"],
		["Payment method", transaction.payment_method || "Not available"],
		["Category", transaction.category],
		["Record source", transaction.source],
		["Date added", transaction.created_at],
	];
	const list = document.createElement("dl");
	list.className = "details-list";
	for (const [label, value] of fields) {
		const item = document.createElement("div");
		item.className = "details-item";
		const term = document.createElement("dt");
		term.textContent = label;
		const description = document.createElement("dd");
		description.textContent = value === null || value === undefined || value === ""
			? "Not available"
			: String(value);
		item.append(term, description);
		list.append(item);
	}
	document.querySelector("#securityDetailsTitle").textContent = `Transaction #${transaction.id}`;
	document.querySelector("#securityDetailsContent").replaceChildren(list);
}

async function openSecurityDetails(transactionId) {
	const content = document.querySelector("#securityDetailsContent");
	const loading = document.createElement("p");
	loading.className = "details-loading";
	loading.textContent = "Loading transaction details...";
	content.replaceChildren(loading);
	document.querySelector("#securityDetailsTitle").textContent = "Transaction details";
	securityDialog.showModal();
	try {
		const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
			headers: { Accept: "application/json" },
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || "Could not load transaction details.");
		}
		showSecurityDetails(payload.data);
	} catch (error) {
		const message = document.createElement("p");
		message.className = "details-error";
		message.textContent = error.message || "Could not load transaction details.";
		content.replaceChildren(message);
	}
}

async function loadSecuritySummary() {
	try {
		const response = await fetch("/api/security/summary", {
			headers: { Accept: "application/json" },
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || "Security overview could not be loaded.");
		}
		const data = payload.data;
	document.querySelector("#reviewRecordCount").textContent = `${data.alert_count} ALERTS`;
		renderReviewTransactions(data);
	} catch (error) {
		console.error("Could not load the security overview.", error);
		const feedback = document.querySelector("#securityError");
		feedback.textContent = error.message || "Security overview could not be loaded.";
		feedback.hidden = false;
	}
}

reviewRows.addEventListener("click", (event) => {
	const button = event.target.closest("button[data-transaction-id]");
	if (button) {
		openSecurityDetails(button.dataset.transactionId);
	}
});

document.querySelector("#closeSecurityDetails").addEventListener("click", () => securityDialog.close());
securityDialog.addEventListener("click", (event) => {
	if (event.target === securityDialog) {
		securityDialog.close();
	}
});

loadSecuritySummary();
