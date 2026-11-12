"use strict";

const filtersForm = document.querySelector("#transactionFilters");
const searchInput = document.querySelector("#searchInput");
const transactionRows = document.querySelector("#transactionRows");
const transactionDialog = document.querySelector("#transactionDialog");
const importResult = document.querySelector("#importResult");
let activeListRequest;
let searchTimer;

function formatTransactionDate(value) {
	const parsedDate = new Date(`${value}T00:00:00`);
	if (Number.isNaN(parsedDate.getTime())) {
		return value || "Not available";
	}
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(parsedDate);
}

function formatTransactionAmount(amount, currency) {
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

function readableStatus(value) {
	if (!value) {
		return "Not stored";
	}
	const normalized = String(value).toLowerCase();
	const knownStatuses = {
		successful: "Successful",
		pending: "Pending",
		failed: "Failed",
		suspicious: "Suspicious",
	};
	return knownStatuses[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function addCell(row, value, label, className = "") {
	const cell = document.createElement("td");
	cell.dataset.label = label;
	if (className) {
		cell.className = className;
	}
	cell.textContent = value;
	row.append(cell);
	return cell;
}

function createTransactionRow(transaction) {
	const row = document.createElement("tr");
	addCell(row, `#${transaction.id}`, "ID");
	addCell(row, transaction.description || "Unnamed transaction", "Merchant / description", "record-description");
	addCell(row, formatTransactionDate(transaction.transaction_date), "Date");
	addCell(row, Number(transaction.amount).toFixed(2), "Amount", "record-amount");
	addCell(row, transaction.currency || "Not available", "Currency");

	const statusCell = document.createElement("td");
	statusCell.dataset.label = "Status";
	const status = document.createElement("span");
	status.className = `status-label${transaction.status ? ` status-${String(transaction.status).toLowerCase()}` : ""}`;
	status.textContent = readableStatus(transaction.status);
	statusCell.append(status);
	row.append(statusCell);

	addCell(row, transaction.payment_method || "Not available", "Method");
	const detailsCell = document.createElement("td");
	detailsCell.dataset.label = "Details";
	const detailsButton = document.createElement("button");
	detailsButton.className = "details-button";
	detailsButton.type = "button";
	detailsButton.dataset.transactionId = String(transaction.id);
	detailsButton.textContent = "View details";
	detailsButton.setAttribute("aria-label", `View details for transaction ${transaction.id}`);
	detailsCell.append(detailsButton);
	row.append(detailsCell);
	return row;
}

function hasActiveFilters() {
	return ["q", "date_from", "date_to", "amount_min", "amount_max", "status"].some(
		(name) => Boolean(filtersForm.elements.namedItem(name)?.value),
	);
}

function showEmptyState(filtered) {
	document.querySelector("#tableScroll").hidden = true;
	const emptyState = document.querySelector("#transactionsEmpty");
	emptyState.hidden = false;
	if (filtered) {
		document.querySelector("#emptyTitle").textContent = "No matching transactions";
		document.querySelector("#emptyDescription").textContent = "Try adjusting your search or filters, or clear them to see every record.";
	} else {
		document.querySelector("#emptyTitle").textContent = "No transactions yet";
		document.querySelector("#emptyDescription").textContent = "Import a CSV file to add records, or wait for a supported payment integration.";
	}
}

function configureStatusFilter(available) {
	const statusFilter = document.querySelector("#statusFilter");
	const help = document.querySelector("#statusHelp");
	statusFilter.disabled = !available;
	statusFilter.replaceChildren(new Option(available ? "All statuses" : "Not stored in this database", ""));
	if (available) {
		for (const [value, label] of [
			["successful", "Successful"],
			["pending", "Pending"],
			["failed", "Failed"],
			["suspicious", "Suspicious"],
		]) {
			statusFilter.add(new Option(label, value));
		}
		help.textContent = "Filter using the payment status saved with each record.";
	} else {
		help.textContent = "Status values are not available for current records.";
	}
}

function renderTransactions(data) {
	configureStatusFilter(data.status_available);
	document.querySelector("#transactionTotal").textContent = new Intl.NumberFormat().format(data.total_transactions);
	document.querySelector("#resultSummary").textContent = hasActiveFilters()
		? `${new Intl.NumberFormat().format(data.total)} matching ${data.total === 1 ? "transaction" : "transactions"}`
		: `Showing all ${new Intl.NumberFormat().format(data.total_transactions)} ${data.total_transactions === 1 ? "transaction" : "transactions"}`;
	document.querySelector("#transactionRows").replaceChildren(...data.transactions.map(createTransactionRow));
	document.querySelector("#filterError").hidden = true;
	if (data.transactions.length) {
		document.querySelector("#tableScroll").hidden = false;
		document.querySelector("#transactionsEmpty").hidden = true;
	} else {
		showEmptyState(hasActiveFilters());
	}
}

async function loadTransactions() {
	activeListRequest?.abort();
	const controller = new AbortController();
	activeListRequest = controller;
	const parameters = new URLSearchParams();
	for (const [name, value] of new FormData(filtersForm)) {
		if (String(value).trim()) {
			parameters.set(name, String(value).trim());
		}
	}
	document.querySelector("#loadingIndicator").hidden = false;
	document.querySelector("#filterError").hidden = true;
	try {
		const response = await fetch(`/api/transactions?${parameters}`, {
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || "Could not load matching transactions.");
		}
		renderTransactions(payload.data);
	} catch (error) {
		if (error.name === "AbortError") {
			return;
		}
		console.error("Could not load transactions.", error);
		const feedback = document.querySelector("#filterError");
		feedback.textContent = error.message || "Could not load transactions. Please try again.";
		feedback.hidden = false;
		document.querySelector("#resultSummary").textContent = "Transactions could not be loaded";
	} finally {
		if (activeListRequest === controller) {
			document.querySelector("#loadingIndicator").hidden = true;
		}
	}
}

function showImportError(message) {
		importResult.className = "import-result is-error";
	importResult.replaceChildren();
	const title = document.createElement("strong");
	title.textContent = "File not imported";
	const explanation = document.createElement("span");
	explanation.textContent = message;
	importResult.append(title, explanation);
	importResult.hidden = false;
}

function renderImportResult(data) {
	importResult.className = `import-result ${data.rejected_count ? "is-warning" : "is-success"}`;
	importResult.replaceChildren();
	const title = document.createElement("strong");
	title.textContent = `Imported ${data.imported_count} ${data.imported_count === 1 ? "record" : "records"}; ${data.rejected_count} ${data.rejected_count === 1 ? "row needs" : "rows need"} attention.`;
	const summary = document.createElement("span");
	summary.textContent = data.duplicate_count
		? `${data.duplicate_count} duplicate ${data.duplicate_count === 1 ? "row was" : "rows were"} skipped to avoid importing the same CSV record again.`
		: "Valid rows were saved. Rows with problems were not imported.";
	importResult.append(title, summary);
	if (data.rejections.length) {
		const reasons = document.createElement("ul");
		reasons.className = "import-rejections";
		for (const rejection of data.rejections) {
			const item = document.createElement("li");
			item.textContent = `Row ${rejection.row}: ${rejection.reason}`;
			reasons.append(item);
		}
		importResult.append(reasons);
	}
	importResult.hidden = false;
}

async function importCsv(file) {
	if (!file.name.toLowerCase().endsWith(".csv")) {
		showImportError("Choose a file with the .csv extension.");
		return;
	}
	if (file.size > 2 * 1024 * 1024) {
		showImportError("CSV files must be 2 MB or smaller.");
		return;
	}
	importResult.className = "import-result";
	importResult.textContent = "Checking your file...";
	importResult.hidden = false;
	const formData = new FormData();
	formData.append("file", file);
	try {
		const response = await fetch("/api/transactions/import", {
			method: "POST",
			headers: { Accept: "application/json" },
			body: formData,
		});
		const payload = await response.json();
		if (payload.data) {
			renderImportResult(payload.data);
			if (payload.data.imported_count) {
				await loadTransactions();
			}
		} else {
			showImportError(payload.error?.message || "This CSV could not be imported.");
		}
	} catch (error) {
		console.error("Could not import the CSV file.", error);
		showImportError("The app could not reach the server. Your existing records were not changed.");
	}
}

function detailValue(value) {
	if (value === null || value === undefined || value === "") {
		return "Not available";
	}
	return String(value);
}

function renderTransactionDetails(transaction) {
	const fields = [
		["Transaction ID", transaction.id],
		["Merchant / description", transaction.description],
		["Amount", formatTransactionAmount(transaction.amount, transaction.currency || "USD")],
		["Currency", transaction.currency],
		["Date", formatTransactionDate(transaction.transaction_date)],
		["Status", readableStatus(transaction.status)],
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
		description.textContent = detailValue(value);
		item.append(term, description);
		list.append(item);
	}
	const content = document.querySelector("#detailsContent");
	content.replaceChildren(list);
	document.querySelector("#detailsTitle").textContent = `Transaction #${transaction.id}`;
}

async function openTransactionDetails(transactionId) {
	const content = document.querySelector("#detailsContent");
	content.innerHTML = "";
	const loading = document.createElement("p");
	loading.className = "details-loading";
		loading.textContent = "Loading transaction details...";
	content.append(loading);
	document.querySelector("#detailsTitle").textContent = "Transaction details";
	transactionDialog.showModal();
	try {
		const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
			headers: { Accept: "application/json" },
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || "Could not load transaction details.");
		}
		renderTransactionDetails(payload.data);
	} catch (error) {
		const message = document.createElement("p");
		message.className = "details-error";
		message.textContent = error.message || "Could not load transaction details.";
		content.replaceChildren(message);
	}
}

filtersForm.addEventListener("submit", (event) => {
	event.preventDefault();
	loadTransactions();
});

searchInput.addEventListener("input", () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(loadTransactions, 250);
});

for (const input of ["dateFrom", "dateTo", "amountMin", "amountMax"]) {
	document.querySelector(`#${input}`).addEventListener("change", loadTransactions);
	if (input.startsWith("amount")) {
		document.querySelector(`#${input}`).addEventListener("input", () => {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(loadTransactions, 250);
		});
	}
}

document.querySelector("#sortOrder").addEventListener("change", loadTransactions);
document.querySelector("#statusFilter").addEventListener("change", loadTransactions);
document.querySelector("#clearFilters").addEventListener("click", () => {
	filtersForm.reset();
	document.querySelector("#filterError").hidden = true;
	loadTransactions();
});

document.querySelector("#openImportButton").addEventListener("click", () => {
	document.querySelector("#csvFile").click();
});

document.querySelector("#csvFile").addEventListener("change", async (event) => {
	const fileInput = event.currentTarget;
	const [file] = fileInput.files;
	if (file) {
		await importCsv(file);
	}
	fileInput.value = "";
});

transactionRows.addEventListener("click", (event) => {
	const button = event.target.closest("button[data-transaction-id]");
	if (button) {
		openTransactionDetails(button.dataset.transactionId);
	}
});

document.querySelector("#closeDetails").addEventListener("click", () => transactionDialog.close());
transactionDialog.addEventListener("click", (event) => {
	if (event.target === transactionDialog) {
		transactionDialog.close();
	}
});

loadTransactions();