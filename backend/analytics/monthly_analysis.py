"""Read-only summaries for the overview dashboard."""

from contextlib import closing
from datetime import date, timedelta
import sqlite3
from typing import Mapping

from database.db import get_db_connection


def _last_six_months() -> list[str]:
	"""Return six YYYY-MM keys ending with the current month."""
	month_start = date.today().replace(day=1)
	months = []
	for _ in range(6):
		months.append(month_start.strftime("%Y-%m"))
		month_start = (month_start - timedelta(days=1)).replace(day=1)
	return list(reversed(months))


def get_dashboard_summary() -> dict:
	"""Summarize real transaction rows without assuming a status or risk field."""
	months = _last_six_months()
	try:
		with closing(get_db_connection()) as connection:
			transaction_count = connection.execute(
				"SELECT COUNT(*) FROM transactions"
			).fetchone()[0]

			volume_by_currency = [
				{"currency": row[0], "amount": float(row[1] or 0)}
				for row in connection.execute(
					"""
					SELECT UPPER(TRIM(COALESCE(NULLIF(currency, ''), 'USD'))) AS currency,
					       SUM(amount) AS amount
					FROM transactions
					GROUP BY currency
					ORDER BY currency
					"""
				).fetchall()
			]

			month_counts = {
				row[0]: row[1]
				for row in connection.execute(
					"""
					SELECT strftime('%Y-%m', transaction_date) AS month, COUNT(*)
					FROM transactions
					WHERE strftime('%Y-%m', transaction_date) BETWEEN ? AND ?
					GROUP BY month
					""",
					(months[0], months[-1]),
				).fetchall()
			}
			monthly_activity = [
				{"month": month, "count": month_counts.get(month, 0)}
				for month in months
			]

			recent_transactions = [
				{
					"id": row["id"],
					"transaction_date": row["transaction_date"],
					"description": row["description"],
					"amount": float(row["amount"]),
					"currency": row["currency"],
					"category": row["category"],
					"source": row["source"],
				}
				for row in connection.execute(
					"""
					SELECT id, transaction_date, description, amount, currency, category, source
					FROM transactions
					ORDER BY id DESC
					LIMIT 5
					"""
				).fetchall()
			]
	except sqlite3.Error as exc:
		raise RuntimeError("Could not load the dashboard summary.") from exc

	return {
		"transaction_count": transaction_count,
		"volume_by_currency": volume_by_currency,
		"monthly_activity": monthly_activity,
		"recent_transactions": recent_transactions,
		"status_tracking_available": False,
		"risk_detection_enabled": False,
	}


ANALYTICS_PERIODS = {"daily", "weekly", "monthly"}
ANALYTICS_BUCKET_SQL = {
	"daily": "date(transaction_date)",
	"weekly": "date(transaction_date, '-' || ((CAST(strftime('%w', transaction_date) AS INTEGER) + 6) % 7) || ' days')",
	"monthly": "strftime('%Y-%m-01', transaction_date)",
}


class AnalyticsInputError(ValueError):
	"""An invalid analytics period or date range supplied by the user."""


def _analytics_date(value: str, label: str) -> date:
	try:
		parsed = date.fromisoformat(value)
	except ValueError as exc:
		raise AnalyticsInputError(f"{label} must use YYYY-MM-DD format.") from exc
	if parsed.isoformat() != value:
		raise AnalyticsInputError(f"{label} must use YYYY-MM-DD format.")
	return parsed


def _default_start(period: str, end_date: date) -> date:
	if period == "daily":
		return end_date - timedelta(days=29)
	if period == "weekly":
		return end_date - timedelta(days=83)
	month_index = end_date.year * 12 + end_date.month - 1 - 11
	return date(month_index // 12, month_index % 12 + 1, 1)


def _analytics_range(filters: Mapping[str, str]) -> tuple[str, date, date]:
	period = filters.get("period", "monthly").strip().lower()
	if period not in ANALYTICS_PERIODS:
		raise AnalyticsInputError("Choose daily, weekly, or monthly analytics.")

	provided_start = filters.get("date_from", "").strip()
	provided_end = filters.get("date_to", "").strip()
	end_date = _analytics_date(provided_end, "End date") if provided_end else date.today()
	start_date = (
		_analytics_date(provided_start, "Start date")
		if provided_start
		else _default_start(period, end_date)
	)
	if start_date > end_date:
		raise AnalyticsInputError("Start date must be on or before end date.")
	if (end_date - start_date).days + 1 > 366:
		raise AnalyticsInputError("Choose a date range of 366 days or fewer.")
	return period, start_date, end_date


def _period_buckets(period: str, start_date: date, end_date: date) -> list[str]:
	if period == "daily":
		current = start_date
		buckets = []
		while current <= end_date:
			buckets.append(current.isoformat())
			current += timedelta(days=1)
		return buckets
	if period == "weekly":
		current = start_date - timedelta(days=start_date.weekday())
		last = end_date - timedelta(days=end_date.weekday())
		buckets = []
		while current <= last:
			buckets.append(current.isoformat())
			current += timedelta(days=7)
		return buckets
	current = start_date.replace(day=1)
	last = end_date.replace(day=1)
	buckets = []
	while current <= last:
		buckets.append(current.isoformat())
		month_index = current.year * 12 + current.month
		current = date(month_index // 12, month_index % 12 + 1, 1)
	return buckets


def _range_summary(connection: sqlite3.Connection, start_date: date, end_date: date) -> dict:
	parameters = (start_date.isoformat(), end_date.isoformat())
	transaction_count = connection.execute(
		"""
		SELECT COUNT(*) FROM transactions
		WHERE date(transaction_date) BETWEEN date(?) AND date(?)
		""",
		parameters,
	).fetchone()[0]
	volume_by_currency = [
		{"currency": row[0], "amount": float(row[1] or 0)}
		for row in connection.execute(
			"""
			SELECT UPPER(TRIM(COALESCE(NULLIF(currency, ''), 'USD'))) AS currency,
			       SUM(amount) AS amount
			FROM transactions
			WHERE date(transaction_date) BETWEEN date(?) AND date(?)
			GROUP BY currency
			ORDER BY currency
			""",
			parameters,
		).fetchall()
	]
	return {"transaction_count": transaction_count, "volume_by_currency": volume_by_currency}


def get_analytics_summary(filters: Mapping[str, str]) -> dict:
	"""Calculate date-bucketed activity and comparisons from actual records."""
	period, start_date, end_date = _analytics_range(filters)
	span_days = (end_date - start_date).days + 1
	previous_end = start_date - timedelta(days=1)
	previous_start = previous_end - timedelta(days=span_days - 1)
	buckets = _period_buckets(period, start_date, end_date)
	bucket_sql = ANALYTICS_BUCKET_SQL[period]
	date_parameters = (start_date.isoformat(), end_date.isoformat())

	try:
		with closing(get_db_connection()) as connection:
			columns = {row[1] for row in connection.execute("PRAGMA table_info(transactions)")}
			current_summary = _range_summary(connection, start_date, end_date)
			previous_summary = _range_summary(connection, previous_start, previous_end)

			bucket_counts = {
				row[0]: row[1]
				for row in connection.execute(
					f"""
					SELECT {bucket_sql} AS bucket, COUNT(*)
					FROM transactions
					WHERE date(transaction_date) BETWEEN date(?) AND date(?)
					GROUP BY bucket
					ORDER BY bucket
					""",
					date_parameters,
				).fetchall()
			}
			bucket_volumes = {}
			for row in connection.execute(
				f"""
				SELECT {bucket_sql} AS bucket,
				       UPPER(TRIM(COALESCE(NULLIF(currency, ''), 'USD'))) AS currency,
				       SUM(amount) AS amount
				FROM transactions
				WHERE date(transaction_date) BETWEEN date(?) AND date(?)
				GROUP BY bucket, currency
				ORDER BY bucket, currency
				""",
				date_parameters,
			).fetchall():
				bucket_volumes.setdefault(row[0], []).append(
					{"currency": row[1], "amount": float(row[2] or 0)}
				)

			category_breakdown = []
			if "category" in columns:
				category_breakdown = [
					{
						"category": row[0],
						"currency": row[1],
						"transaction_count": row[2],
						"amount": float(row[3] or 0),
					}
					for row in connection.execute(
						"""
						SELECT COALESCE(NULLIF(TRIM(category), ''), 'uncategorized') AS category,
						       UPPER(TRIM(COALESCE(NULLIF(currency, ''), 'USD'))) AS currency,
						       COUNT(*), SUM(amount)
						FROM transactions
						WHERE date(transaction_date) BETWEEN date(?) AND date(?)
						GROUP BY category, currency
						ORDER BY category, currency
						""",
						date_parameters,
					).fetchall()
				]

			status_breakdown = []
			if "status" in columns:
				status_breakdown = [
					{"status": row[0], "transaction_count": row[1]}
					for row in connection.execute(
						"""
						SELECT LOWER(TRIM(status)), COUNT(*)
						FROM transactions
						WHERE date(transaction_date) BETWEEN date(?) AND date(?)
						GROUP BY LOWER(TRIM(status))
						ORDER BY LOWER(TRIM(status))
						""",
						date_parameters,
					).fetchall()
				]
	except sqlite3.Error as exc:
		raise RuntimeError("Could not calculate analytics from the transaction records.") from exc

	activity = [
		{
			"period_start": bucket,
			"transaction_count": bucket_counts.get(bucket, 0),
			"volume_by_currency": bucket_volumes.get(bucket, []),
		}
		for bucket in buckets
	]
	previous_amounts = {
		item["currency"]: item["amount"]
		for item in previous_summary["volume_by_currency"]
	}
	current_amounts = {
		item["currency"]: item["amount"]
		for item in current_summary["volume_by_currency"]
	}
	currency_comparisons = [
		{
			"currency": currency,
			"current_amount": current_amounts.get(currency, 0),
			"previous_amount": previous_amounts.get(currency, 0),
			"change_amount": current_amounts.get(currency, 0) - previous_amounts.get(currency, 0),
			"change_percent": (
				(current_amounts.get(currency, 0) - previous_amounts.get(currency, 0))
				/ previous_amounts[currency]
				* 100
				if previous_amounts.get(currency)
				else None
			),
		}
		for currency in sorted(current_amounts.keys() | previous_amounts.keys())
	]
	previous_count = previous_summary["transaction_count"]
	count_change = current_summary["transaction_count"] - previous_count
	count_change_percent = (count_change / previous_count * 100) if previous_count else None

	return {
		"period": period,
		"date_from": start_date.isoformat(),
		"date_to": end_date.isoformat(),
		"transaction_count": current_summary["transaction_count"],
		"volume_by_currency": current_summary["volume_by_currency"],
		"activity": activity,
		"category_breakdown": {"available": "category" in columns, "items": category_breakdown},
		"status_breakdown": {"available": "status" in columns, "items": status_breakdown},
		"previous_period": {
			"date_from": previous_start.isoformat(),
			"date_to": previous_end.isoformat(),
			"transaction_count": previous_count,
			"volume_by_currency": previous_summary["volume_by_currency"],
		},
		"comparison": {
			"transaction_count_change": count_change,
			"transaction_count_change_percent": count_change_percent,
			"volume_by_currency": currency_comparisons,
		},
	}
