import sqlite3
import unittest

from backend.ai.risk_model import score_transactions


SCHEMA = """
CREATE TABLE transactions (
	 id INTEGER PRIMARY KEY,
	 transaction_date TEXT NOT NULL,
	 description TEXT NOT NULL,
	 amount REAL NOT NULL,
	 currency TEXT NOT NULL,
	 category TEXT NOT NULL,
	 source TEXT NOT NULL,
	 created_at TEXT NOT NULL
)
"""


class RiskModelTests(unittest.TestCase):
	def setUp(self):
		self.connection = sqlite3.connect(":memory:")
		self.connection.executescript(SCHEMA)

	def tearDown(self):
		self.connection.close()

	def add(self, transaction_id, transaction_date, description, amount):
		self.connection.execute(
			"""
			INSERT INTO transactions
			(id, transaction_date, description, amount, currency, category, source, created_at)
			VALUES (?, ?, ?, ?, 'USD', 'Test', 'test', '2026-11-12 00:00:00')
			""",
			(transaction_id, transaction_date, description, amount),
		)
		self.connection.commit()

	def test_normal_transaction_is_low(self):
		self.add(1, "2026-11-01", "Coffee", 10)
		self.add(2, "2026-11-02", "Groceries", 20)

		result = score_transactions(self.connection)

		self.assertEqual(result["transaction_count"], 2)
		self.assertEqual(result["level_counts"], {"low": 2, "medium": 0, "high": 0})

	def test_duplicate_and_large_sensitive_record_is_high(self):
		self.add(1, "2026-11-01", "Coffee", 10)
		self.add(2, "2026-11-02", "Groceries", 20)
		self.add(3, "2026-11-03", "Gift card purchase", 500)
		self.add(4, "2026-11-03", "Gift card purchase", 500)

		result = score_transactions(self.connection)
		alert = next(item for item in result["alerts"] if item["id"] == 3)

		self.assertEqual(alert["risk_level"], "high")
		self.assertGreaterEqual(alert["risk_score"], 70)
		self.assertGreaterEqual(len(alert["risk_reasons"]), 2)

	def test_alerts_are_limited_but_counts_include_all_records(self):
		for transaction_id in range(1, 8):
			self.add(transaction_id, "2026-11-04", "Repeated payment", 40)

		result = score_transactions(self.connection, limit=3)

		self.assertEqual(result["transaction_count"], 7)
		self.assertEqual(len(result["recent_transactions"]), 3)
		self.assertEqual(result["alert_count"], 7)


if __name__ == "__main__":
	unittest.main()
