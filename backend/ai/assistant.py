"""Transparent, rule-based answers from locally stored transaction data."""

from contextlib import closing
from datetime import date, timedelta
import sqlite3

from database.db import get_db_connection
from backend.ai.shopping import search_product_links


MAX_QUESTION_LENGTH = 300


class AssistantInputError(ValueError):
	"""An invalid question submitted to the assistant."""


def _currency_totals(
	connection: sqlite3.Connection,
	start_date: date | None = None,
	end_date: date | None = None,
) -> list[dict]:
	conditions = []
	parameters = []
	if start_date:
		conditions.append("date(transaction_date) >= date(?)")
		parameters.append(start_date.isoformat())
	if end_date:
		conditions.append("date(transaction_date) <= date(?)")
		parameters.append(end_date.isoformat())
	where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
	return [
		{"currency": row[0], "amount": float(row[1] or 0)}
		for row in connection.execute(
			f"""
			SELECT UPPER(TRIM(COALESCE(NULLIF(currency, ''), 'USD'))) AS currency,
			       SUM(amount) AS amount
			FROM transactions
			{where_clause}
			GROUP BY currency
			ORDER BY currency
			""",
			parameters,
		).fetchall()
	]


def _format_totals(totals: list[dict]) -> str:
	if not totals:
		return "No transaction records were found for this period."
	return "; ".join(
		f"{item['currency']} {item['amount']:,.2f}" for item in totals
	)


def _monthly_ranges(today: date) -> tuple[date, date, date, date]:
	current_start = today.replace(day=1)
	previous_end = current_start - timedelta(days=1)
	previous_start = previous_end.replace(day=1)
	previous_comparable_end = previous_start.replace(
		day=min(today.day, previous_end.day)
	)
	return current_start, today, previous_start, previous_comparable_end


def _question_intent(question: str) -> str:
	text = question.casefold()
	if any(phrase in text for phrase in ("find me", "search for", "look for", "buy me", "shop for", "recommend a", "product")):
		return "shopping"
	if any(word in text for word in ("security", "alert", "suspicious", "fraud", "risk")):
		return "security"
	if "recent" in text or ("show" in text and "transaction" in text):
		return "recent"
	if "categor" in text:
		return "categories"
	if "compar" in text or ("this month" in text and "last month" in text):
		return "compare"
	if "volume" in text or "total" in text or "overall" in text:
		return "volume"
	if "month" in text or any(word in text for word in ("spent", "spending", "spend")):
		return "monthly"
	if any(word in text for word in ("summar", "activity", "overview")):
		return "summary"
	return "unsupported"


def answer_financial_question(question: str) -> dict:
	"""Answer supported questions using SQLite; never call an external AI service."""
	question = question.strip()
	if not question:
		raise AssistantInputError("Type a question to get started.")
	if len(question) > MAX_QUESTION_LENGTH:
		raise AssistantInputError(
			f"Please keep your question to {MAX_QUESTION_LENGTH} characters or fewer."
		)
	intent = _question_intent(question)
	if intent == "shopping":
		shopping = search_product_links(question)
		return {
			"answer": f"I found global places to compare {shopping['query']}. Open a result, then confirm PayPal is available at checkout.",
			"source": "Marketplace search links",
			"external_ai_configured": False,
			"shopping": shopping,
		}
	today = date.today()
	current_start, current_end, previous_start, previous_end = _monthly_ranges(today)

	try:
		with closing(get_db_connection()) as connection:
			transaction_count = connection.execute(
				"SELECT COUNT(*) FROM transactions"
			).fetchone()[0]
			current_month_count = connection.execute(
				"""
				SELECT COUNT(*) FROM transactions
				WHERE date(transaction_date) BETWEEN date(?) AND date(?)
				""",
				(current_start.isoformat(), current_end.isoformat()),
			).fetchone()[0]
			previous_month_count = connection.execute(
				"""
				SELECT COUNT(*) FROM transactions
				WHERE date(transaction_date) BETWEEN date(?) AND date(?)
				""",
				(previous_start.isoformat(), previous_end.isoformat()),
			).fetchone()[0]
			all_time_totals = _currency_totals(connection)
			month_totals = _currency_totals(connection, current_start, current_end)
			previous_month_totals = _currency_totals(connection, previous_start, previous_end)
			recent_transactions = connection.execute(
				"""
				SELECT transaction_date, description, amount, currency
				FROM transactions
				ORDER BY transaction_date DESC, id DESC
				LIMIT 5
				"""
			).fetchall()
			categories = connection.execute(
				"""
				SELECT COALESCE(NULLIF(TRIM(category), ''), 'uncategorized') AS category,
				       UPPER(TRIM(COALESCE(NULLIF(currency, ''), 'USD'))) AS currency,
				       COUNT(*)
				FROM transactions
				GROUP BY category, currency
				ORDER BY category, currency
				"""
			).fetchall()
	except sqlite3.Error as exc:
		raise RuntimeError("The local transaction data is temporarily unavailable.") from exc
	transaction_word = "record" if transaction_count == 1 else "records"
	current_month_word = "record" if current_month_count == 1 else "records"
	previous_month_word = "record" if previous_month_count == 1 else "records"

	if intent == "security":
		answer = (
			"Automatic security monitoring is not configured, so I cannot confirm or rule out suspicious payments. "
			"No security alerts are stored. Please review any concern with the original payment provider."
		)
	elif intent == "recent":
		if not recent_transactions:
			answer = "There are no transaction records yet. Import a CSV to add records from your payment platforms."
		else:
			lines = ["Here are your five most recent saved records:"]
			for row in recent_transactions:
				lines.append(
					f"{row['transaction_date']} - {row['description']}: "
					f"{row['currency']} {float(row['amount']):,.2f}"
				)
			answer = "\n".join(lines)
	elif intent == "categories":
		if not categories:
			answer = "No transaction categories are available because there are no saved records yet."
		else:
			lines = ["These categories come from your saved records (totals are grouped by currency):"]
			for row in categories:
				lines.append(f"{row['category']} - {row['currency']}: {row['count']} records")
			answer = "\n".join(lines)
	elif intent == "compare":
		current_totals_text = _format_totals(month_totals) if month_totals else "no saved records"
		previous_totals_text = _format_totals(previous_month_totals) if previous_month_totals else "no saved records"
		answer = (
			f"This month so far ({current_start:%b %d} to {current_end:%b %d}) has "
			f"{current_month_count} {current_month_word} totaling {current_totals_text}. The comparable dates last month "
			f"({previous_start:%b %d} to {previous_end:%b %d}) had "
			f"{previous_month_count} {previous_month_word} totaling {previous_totals_text}. "
			"Each currency is compared separately."
		)
	elif intent == "monthly":
		if not current_month_count:
			answer = f"No transactions are saved for {today:%B} yet. Import a CSV to add records from your payment platforms."
		else:
			answer = (
				f"From {current_start:%b %d} through {current_end:%b %d}, you have "
				f"{current_month_count} saved {current_month_word} totaling {_format_totals(month_totals)}. These are recorded transaction amounts, "
				"grouped by currency; payment status is not stored."
			)
	elif intent == "volume":
		if not transaction_count:
			answer = "There are no saved transaction records yet. Import a CSV to see transaction volume."
		else:
			answer = (
				f"I found {transaction_count} saved transaction {transaction_word}. Their recorded volume is "
				f"{_format_totals(all_time_totals)}. Different currencies are not combined."
			)
	elif intent == "summary":
		if not transaction_count:
			answer = "There are no saved transaction records yet. Import a CSV to get a summary of your activity."
		else:
			category_count = len({row["category"] for row in categories})
			monthly_text = _format_totals(month_totals) if month_totals else "no records yet"
			answer = (
				f"There are {transaction_count} saved transaction {transaction_word} with recorded volume "
				f"of {_format_totals(all_time_totals)}. This month so far: {current_month_count} records, {monthly_text}. "
				f"{category_count} saved categories are available. Payment status and automatic risk detection are not configured."
			)
	else:
		answer = (
			"I can answer questions about this month's recorded amounts, compare this month with last month, "
			"show transaction volume, list recent records or categories, and explain security-data availability. "
			"External AI is not configured; these replies are generated from your local records using simple rules."
		)

	return {
		"answer": answer,
		"source": "Rule-based summary from local transaction data",
		"external_ai_configured": False,
	}
