import os
import unittest
from unittest.mock import patch

from backend.payments.paypal_api import (
	PayPalClient,
	PayPalConfigurationError,
	PayPalSettings,
	load_paypal_settings,
	transaction_report_to_csv,
)


class PayPalApiTests(unittest.TestCase):
	def test_default_configuration_is_not_active(self):
		with patch.dict(os.environ, {}, clear=True):
			settings = load_paypal_settings()

		self.assertFalse(settings.configured)
		self.assertIn("sandbox", settings.base_url)

	def test_client_rejects_missing_credentials(self):
		settings = PayPalSettings("", "", "https://api-m.sandbox.paypal.com")

		with self.assertRaises(PayPalConfigurationError):
			PayPalClient(settings)

	def test_client_rejects_non_https_endpoint(self):
		settings = PayPalSettings("id", "secret", "http://localhost")

		with self.assertRaises(PayPalConfigurationError):
			PayPalClient(settings)

	def test_transaction_report_is_normalized_without_sensitive_fields(self):
		payload = {
			"transaction_details": [{
				"transaction_info": {
					"transaction_initiation_date": "2026-11-10T10:20:30Z",
					"transaction_subject": "Sample order",
					"transaction_amount": {"value": "12.50", "currency_code": "USD"},
					"transaction_id": "PAYPAL-ID-123",
				}
			}]
		}

		csv_text = transaction_report_to_csv(payload).decode("utf-8")

		self.assertIn("2026-11-10,Sample order,12.50,USD,paypal", csv_text)
		self.assertNotIn("PAYPAL-ID-123", csv_text)


if __name__ == "__main__":
	unittest.main()
