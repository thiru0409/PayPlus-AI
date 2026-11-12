"""Small, secret-safe PayPal REST client for optional sandbox syncing."""

from dataclasses import dataclass
from datetime import date
import csv
from io import StringIO
import os

import requests


class PayPalConfigurationError(RuntimeError):
	"""PayPal credentials or endpoint configuration is missing or invalid."""


class PayPalAPIError(RuntimeError):
	"""PayPal returned an error response."""


@dataclass(frozen=True)
class PayPalSettings:
	client_id: str
	client_secret: str
	base_url: str

	@property
	def configured(self) -> bool:
		placeholders = ("", "your_sandbox_client_id", "your_sandbox_client_secret")
		return self.client_id not in placeholders and self.client_secret not in placeholders


def load_paypal_settings() -> PayPalSettings:
	"""Read PayPal settings without printing or returning the client secret."""
	return PayPalSettings(
		client_id=os.getenv("PAYPAL_CLIENT_ID", "").strip(),
		client_secret=os.getenv("PAYPAL_CLIENT_SECRET", "").strip(),
		base_url=os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com").strip().rstrip("/"),
	)


class PayPalClient:
	"""Authenticated PayPal client with short timeouts and no secret logging."""

	def __init__(self, settings: PayPalSettings | None = None):
		self.settings = settings or load_paypal_settings()
		if not self.settings.base_url.startswith("https://"):
			raise PayPalConfigurationError("PAYPAL_BASE_URL must use HTTPS.")
		if not self.settings.configured:
			raise PayPalConfigurationError("PayPal credentials are not configured in .env.")

	def _access_token(self) -> str:
		response = requests.post(
			f"{self.settings.base_url}/v1/oauth2/token",
			auth=(self.settings.client_id, self.settings.client_secret),
			data={
				"grant_type": "client_credentials",
				"scope": "https://uri.paypal.com/services/reporting/search/read",
			},
			headers={"Accept": "application/json", "Accept-Language": "en_US"},
			timeout=15,
		)
		if not response.ok:
			raise PayPalAPIError(f"PayPal authentication failed with HTTP {response.status_code}.")
		try:
			return response.json()["access_token"]
		except (KeyError, ValueError) as exc:
			raise PayPalAPIError("PayPal authentication returned an invalid response.") from exc

	def get_transaction_report(self, start_date: str, end_date: str) -> dict:
		"""Fetch a PayPal transaction report; callers decide how to import rows."""
		token = self._access_token()
		response = requests.get(
			f"{self.settings.base_url}/v1/reporting/transactions",
			params={
				"start_date": start_date,
				"end_date": end_date,
				"fields": "transaction_info",
				"page_size": 100,
			},
			headers={
				"Accept": "application/json",
				"Authorization": f"Bearer {token}",
				"PayPal-Enforce-ISO8601-Format": "true",
			},
			timeout=20,
		)
		if not response.ok:
			raise PayPalAPIError(f"PayPal transaction request failed with HTTP {response.status_code}.")
		try:
			return response.json()
		except ValueError as exc:
			raise PayPalAPIError("PayPal returned an invalid transaction response.") from exc


def transaction_report_to_csv(payload: dict) -> bytes:
	"""Convert PayPal transaction details to the app's safe import format."""
	rows = []
	for item in payload.get("transaction_details", []):
		info = item.get("transaction_info") or {}
		money = info.get("transaction_amount") or {}
		transaction_date = (info.get("transaction_initiation_date") or "")[:10]
		amount = money.get("value")
		currency = money.get("currency_code")
		if not transaction_date or amount is None or not currency:
			continue
		try:
			date.fromisoformat(transaction_date)
		except ValueError:
			continue
		description = (
			info.get("transaction_subject")
			or info.get("transaction_note")
			or info.get("transaction_id")
			or "PayPal transaction"
		)
		rows.append({
			"transaction_date": transaction_date,
			"description": str(description)[:200],
			"amount": str(amount),
			"currency": str(currency).upper(),
			"category": "paypal",
		})
	output = StringIO(newline="")
	writer = csv.DictWriter(
		output,
		fieldnames=["transaction_date", "description", "amount", "currency", "category"],
	)
	writer.writeheader()
	writer.writerows(rows)
	return output.getvalue().encode("utf-8")
