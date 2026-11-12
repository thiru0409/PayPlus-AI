"""Transaction lookup and CSV import services."""

import csv
from contextlib import closing
from datetime import date
from decimal import Decimal, InvalidOperation
from io import StringIO
import math
import re
import sqlite3
from typing import Mapping

from database.db import get_db_connection


MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_CSV_ROWS = 5000
REQUIRED_CSV_COLUMNS = {"transaction_date", "description", "amount", "currency"}
ALLOWED_CSV_COLUMNS = REQUIRED_CSV_COLUMNS | {"category"}
VALID_STATUSES = {"successful", "pending", "failed", "suspicious"}
SORT_COLUMNS = {
	"newest": "transaction_date DESC, id DESC",
	"oldest": "transaction_date ASC, id ASC",
	"amount_high": "amount DESC, id DESC",
	"amount_low": "amount ASC, id ASC",
}


class TransactionInputError(ValueError):
	"""An invalid transaction filter or CSV file supplied by the user."""


def _parse_date(value: str, label: str) -> str:
	try:
		parsed = date.fromisoformat(value)
	except ValueError as exc:
		raise TransactionInputError(f"{label} must use YYYY-MM-DD format.") from exc
	if parsed.isoformat() != value:
		raise TransactionInputError(f"{label} must use YYYY-MM-DD format.")
	return value


def _parse_amount(value: str, label: str) -> Decimal:
	try:
		amount = Decimal(value)
	except (InvalidOperation, ValueError) as exc:
		raise TransactionInputError(f"{label} must be a valid number.") from exc
	if not amount.is_finite():
		raise TransactionInputError(f"{label} must be a finite number.")
	try:
		float_amount = float(amount)
	except (OverflowError, ValueError) as exc:
		raise TransactionInputError(f"{label} is outside the supported numeric range.") from exc
	if not math.isfinite(float_amount) or (amount != 0 and float_amount == 0):
		raise TransactionInputError(f"{label} is outside the supported numeric range.")
	return amount


def _transaction_dict(row: sqlite3.Row) -> dict:
	transaction = dict(row)
	if transaction.get("amount") is not None:
		transaction["amount"] = float(transaction["amount"])
	transaction.setdefault("status", None)
	transaction.setdefault("payment_method", None)
	return transaction


def list_transactions(filters: Mapping[str, str]) -> dict:
	"""Return every matching record; filtering and ordering happen in SQLite."""
	search = filters.get("q", "").strip()
	if len(search) > 100 or "\x00" in search:
		raise TransactionInputError("Search text must be 100 characters or fewer.")

	date_from = filters.get("date_from", "").strip()
	date_to = filters.get("date_to", "").strip()
	if date_from:
		date_from = _parse_date(date_from, "Start date")
	if date_to:
		date_to = _parse_date(date_to, "End date")
	if date_from and date_to and date_from > date_to:
		raise TransactionInputError("Start date must be on or before end date.")

	minimum = filters.get("amount_min", "").strip()
	maximum = filters.get("amount_max", "").strip()
	minimum_amount = _parse_amount(minimum, "Minimum amount") if minimum else None
	maximum_amount = _parse_amount(maximum, "Maximum amount") if maximum else None
	if minimum_amount is not None and maximum_amount is not None and minimum_amount > maximum_amount:
		raise TransactionInputError("Minimum amount must not exceed maximum amount.")

	status = filters.get("status", "").strip().lower()
	if status and status not in VALID_STATUSES:
		raise TransactionInputError("Choose a supported transaction status.")

	sort = filters.get("sort", "newest").strip()
	if sort not in SORT_COLUMNS:
		raise TransactionInputError("Choose a supported sort order.")

	conditions = []
	parameters = []
	if search:
		conditions.append("(CAST(id AS TEXT) = ? OR instr(LOWER(description), LOWER(?)) > 0)")
		parameters.extend((search, search))
	if date_from:
		conditions.append("transaction_date >= ?")
		parameters.append(date_from)
	if date_to:
		conditions.append("transaction_date <= ?")
		parameters.append(date_to)
	if minimum_amount is not None:
		conditions.append("amount >= ?")
		parameters.append(float(minimum_amount))
	if maximum_amount is not None:
		conditions.append("amount <= ?")
		parameters.append(float(maximum_amount))

	where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
	try:
		with closing(get_db_connection()) as connection:
			columns = {row[1] for row in connection.execute("PRAGMA table_info(transactions)")}
			total_transactions = connection.execute(
				"SELECT COUNT(*) FROM transactions"
			).fetchone()[0]
			if status and "status" not in columns:
				raise TransactionInputError(
					"Status filtering is unavailable because transaction status is not stored."
				)
			if status:
				conditions.append("LOWER(COALESCE(status, '')) = ?")
				parameters.append(status)
				where_clause = f"WHERE {' AND '.join(conditions)}"
			total = connection.execute(
				f"SELECT COUNT(*) FROM transactions {where_clause}", parameters
			).fetchone()[0]
			rows = connection.execute(
				f"SELECT * FROM transactions {where_clause} ORDER BY {SORT_COLUMNS[sort]}",
				parameters,
			).fetchall()
	except sqlite3.Error as exc:
		raise RuntimeError("Could not load transactions from the database.") from exc

	return {
		"transactions": [_transaction_dict(row) for row in rows],
		"total": total,
		"total_transactions": total_transactions,
		"status_available": "status" in columns,
		"payment_method_available": "payment_method" in columns,
	}


def get_transaction(transaction_id: int) -> dict | None:
	"""Return a transaction with all fields available in the current schema."""
	try:
		with closing(get_db_connection()) as connection:
			row = connection.execute(
				"SELECT * FROM transactions WHERE id = ?", (transaction_id,)
			).fetchone()
	except sqlite3.Error as exc:
		raise RuntimeError("Could not load transaction details.") from exc
	return _transaction_dict(row) if row else None


def _validated_csv_record(row: dict[str, str | None], source: str = "csv") -> dict:
	if None in row or any(value is None for value in row.values()):
		raise TransactionInputError("The row has a different number of values than the header.")

	transaction_date = (row.get("transaction_date") or "").strip()
	if not transaction_date:
		raise TransactionInputError("Transaction date is required.")
	_parse_date(transaction_date, "Transaction date")

	description = (row.get("description") or "").strip()
	if not description:
		raise TransactionInputError("Merchant or description is required.")
	if len(description) > 200:
		raise TransactionInputError("Merchant or description must be 200 characters or fewer.")

	amount_text = (row.get("amount") or "").strip()
	if not amount_text:
		raise TransactionInputError("Amount is required.")
	amount = _parse_amount(amount_text, "Amount")

	currency = (row.get("currency") or "").strip().upper()
	if not re.fullmatch(r"[A-Z]{3}", currency):
		raise TransactionInputError("Currency must be a three-letter code, such as USD.")

	category = (row.get("category") or "uncategorized").strip() or "uncategorized"
	if len(category) > 100:
		raise TransactionInputError("Category must be 100 characters or fewer.")

	return {
		"transaction_date": transaction_date,
		"description": description,
		"amount": float(amount),
		"currency": currency,
		"category": category,
		"source": source,
	}


def _duplicate_key(record: dict) -> tuple:
	return (
		record["transaction_date"],
		record["description"],
		Decimal(str(record["amount"])).normalize(),
		record["currency"],
	)


def import_transactions_csv(filename: str, content: bytes, source: str = "csv") -> dict:
	"""Validate and import supported CSV rows without writing an uploaded file."""
	if source not in {"csv", "paypal"}:
		raise TransactionInputError("Unsupported transaction source.")
	if not filename.lower().endswith(".csv"):
		raise TransactionInputError("Choose a file with the .csv extension.")
	if not content:
		raise TransactionInputError("The CSV file is empty.")
	if len(content) > MAX_CSV_BYTES:
		raise TransactionInputError("The CSV file must be 2 MB or smaller.")
	try:
		text = content.decode("utf-8-sig")
	except UnicodeDecodeError as exc:
		raise TransactionInputError("The CSV must be saved as UTF-8 text.") from exc

	reader = csv.DictReader(StringIO(text, newline=""), strict=True)
	if not reader.fieldnames:
		raise TransactionInputError("The CSV needs a header row.")
	headers = [header.strip().lower() for header in reader.fieldnames if header is not None]
	if len(headers) != len(reader.fieldnames) or any(not header for header in headers):
		raise TransactionInputError("Every CSV column needs a name.")
	if len(headers) != len(set(headers)):
		raise TransactionInputError("The CSV contains duplicate column names.")
	missing = REQUIRED_CSV_COLUMNS - set(headers)
	if missing:
		raise TransactionInputError(
			"Missing required columns: " + ", ".join(sorted(missing)) + "."
		)
	unsupported = set(headers) - ALLOWED_CSV_COLUMNS
	if unsupported:
		extra = ", ".join(sorted(unsupported))
		raise TransactionInputError(
			f"Unsupported columns: {extra}. Status and payment method are not stored in this database."
		)
	reader.fieldnames = headers

	valid_records = []
	rejections = []
	try:
		for row_number, row in enumerate(reader, start=2):
			if row_number > MAX_CSV_ROWS + 1:
				raise TransactionInputError(f"CSV files can contain no more than {MAX_CSV_ROWS} data rows.")
			try:
				valid_records.append((row_number, _validated_csv_record(row, source)))
			except TransactionInputError as exc:
				rejections.append({"row": row_number, "reason": str(exc)})
	except csv.Error as exc:
		raise TransactionInputError("The CSV formatting is invalid. Check quotes and commas.") from exc
	if not valid_records and not rejections:
		raise TransactionInputError("The CSV contains a header but no transaction rows.")

	try:
		with closing(get_db_connection()) as connection:
			columns = {row[1] for row in connection.execute("PRAGMA table_info(transactions)")}
			required_database_columns = {
				"transaction_date", "description", "amount", "currency", "category", "source"
			}
			if not required_database_columns.issubset(columns):
				raise RuntimeError("The transaction table does not support this CSV format.")

			existing_keys = {
				_duplicate_key(dict(row))
				for row in connection.execute(
					"""
					SELECT transaction_date, description, amount, currency, category
					FROM transactions WHERE source = ?
					""",
					(source,),
				).fetchall()
			}
			seen_keys = set(existing_keys)
			insert_records = []
			duplicate_count = 0
			for row_number, record in valid_records:
				key = _duplicate_key(record)
				if key in seen_keys:
					duplicate_count += 1
					rejections.append({"row": row_number, "reason": "This row duplicates a CSV record already imported."})
					continue
				seen_keys.add(key)
				insert_records.append(record)

			with connection:
				connection.executemany(
					"""
					INSERT INTO transactions
						(transaction_date, description, amount, currency, category, source)
					VALUES (?, ?, ?, ?, ?, ?)
					""",
					[
						(
							record["transaction_date"],
							record["description"],
							record["amount"],
							record["currency"],
							record["category"],
							record["source"],
						)
						for record in insert_records
					],
				)
	except sqlite3.Error as exc:
		raise RuntimeError("Could not safely save the CSV transactions.") from exc

	return {
		"imported_count": len(insert_records),
		"rejected_count": len(rejections),
		"duplicate_count": duplicate_count,
		"rejections": sorted(rejections, key=lambda item: item["row"]),
	}
