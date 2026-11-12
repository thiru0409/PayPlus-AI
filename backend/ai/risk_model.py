"""Explainable, local transaction-risk scoring.

This is a screening aid, not a fraud decision system. It uses only fields
already stored in the local SQLite database and never sends records outside
the application.
"""

from collections import Counter, defaultdict
from statistics import median
import sqlite3


MODEL_NAME = "PayPlus Local Risk Model"
MODEL_VERSION = "1.0"


def _level(score: int) -> str:
	if score >= 70:
		return "high"
	if score >= 35:
		return "medium"
	return "low"


def _typical_amount(values: list[float]) -> float:
	"""Estimate a normal amount without letting outliers raise the baseline."""
	sorted_values = sorted(values)
	lower_half = sorted_values[: max(1, (len(sorted_values) + 1) // 2)]
	return float(median(lower_half))


def score_transactions(connection: sqlite3.Connection, limit: int = 5) -> dict:
	"""Score saved transactions using conservative, explainable signals."""
	rows = connection.execute(
		"""
		SELECT id, transaction_date, description, amount, currency, category,
		       source, created_at
		FROM transactions
		ORDER BY transaction_date DESC, id DESC
		"""
	).fetchall()

	amounts_by_currency = defaultdict(list)
	date_counts = Counter()
	duplicate_counts = Counter()
	for row in rows:
		currency = (row[4] or "USD").strip().upper()
		amount = float(row[3] or 0)
		amounts_by_currency[currency].append(abs(amount))
		date_counts[(row[1], currency)] += 1
		duplicate_counts[(row[1], (row[2] or "").strip().casefold(), amount, currency)] += 1

	medians = {
		currency: _typical_amount(values) for currency, values in amounts_by_currency.items()
	}
	assessed = []
	for row in rows:
		currency = (row[4] or "USD").strip().upper()
		description = (row[2] or "").strip()
		amount = float(row[3] or 0)
		key = (row[1], description.casefold(), amount, currency)
		score = 0
		reasons = []
		baseline = medians.get(currency, 0)
		if baseline and abs(amount) >= max(baseline * 5, baseline + 100):
			score += 45
			reasons.append("amount is unusually large for this currency")
		if duplicate_counts[key] > 1:
			score += 35
			reasons.append("matching records appear more than once on the same date")
		if date_counts[(row[1], currency)] >= 10:
			score += 20
			reasons.append("many records share the same date and currency")
		if any(term in description.casefold() for term in ("gift card", "crypto", "cash advance")):
			score += 20
			reasons.append("description contains a category that needs manual review")
		assessed.append({
			"id": row[0],
			"transaction_date": row[1],
			"description": description,
			"amount": amount,
			"currency": currency,
			"category": row[5],
			"source": row[6],
			"created_at": row[7],
			"risk_score": min(score, 100),
			"risk_level": _level(score),
			"risk_reasons": reasons or ["no configured risk signals were found"],
		})

	alerts = [item for item in assessed if item["risk_level"] in {"medium", "high"}]
	level_counts = Counter(item["risk_level"] for item in assessed)
	return {
		"model": {"name": MODEL_NAME, "version": MODEL_VERSION, "type": "local_rules"},
		"transaction_count": len(assessed),
		"scored_transaction_count": len(assessed),
		"level_counts": {level: level_counts.get(level, 0) for level in ("low", "medium", "high")},
		"alert_count": len(alerts),
		"alerts": alerts[:limit] if limit else alerts,
		"recent_transactions": assessed[:limit] if limit else assessed,
	}
