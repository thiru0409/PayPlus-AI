"""Flask application entry point for PayPlus AI."""

from contextlib import closing
from datetime import date
import os
from pathlib import Path
import sqlite3

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from backend.ai.assistant import AssistantInputError, answer_financial_question
from backend.ai.risk_model import score_transactions
from backend.payments.paypal_api import (
	PayPalAPIError,
	PayPalClient,
	PayPalConfigurationError,
	load_paypal_settings,
	transaction_report_to_csv,
)
from backend.analytics.monthly_analysis import (
	AnalyticsInputError,
	get_analytics_summary,
	get_dashboard_summary,
)
from backend.payments.transactions import (
	MAX_CSV_BYTES,
	TransactionInputError,
	get_transaction,
	import_transactions_csv,
	list_transactions,
)
from database.db import get_db_connection, init_db


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CSV_BYTES

# Prepare the local database before Flask begins serving requests.
try:
	init_db()
except RuntimeError:
	app.logger.exception("PayPlus AI could not initialize its database.")
	raise


@app.get("/")
def home():
	"""Show the dashboard."""
	return render_template("index.html")


@app.get("/transactions")
def transactions_page():
	"""Show transaction search and import tools."""
	return render_template("transactions.html")


@app.get("/analytics")
def analytics_page():
	"""Show the database-driven analytics workspace."""
	return render_template("analytics.html")


@app.get("/security")
def security_page():
	"""Show the honest security and risk readiness workspace."""
	return render_template("security.html")


@app.get("/assistant")
def assistant_page():
	"""Show the rule-based financial assistant."""
	return render_template("assistant.html")


@app.get("/settings")
def settings_page():
	"""Show browser-local dashboard personalization."""
	return render_template("settings.html")


@app.post("/api/assistant/message")
def assistant_message():
	"""Answer a question using local SQLite data without an external AI provider."""
	payload = request.get_json(silent=True)
	if not isinstance(payload, dict) or not isinstance(payload.get("question"), str):
		return jsonify({
			"error": {
				"code": "invalid_question",
				"message": "Send a question as plain text.",
			}
		}), 400
	try:
		return jsonify({"data": answer_financial_question(payload["question"])}), 200
	except AssistantInputError as exc:
		return jsonify({
			"error": {"code": "invalid_question", "message": str(exc)}
		}), 400
	except RuntimeError:
		app.logger.exception("PayPlus AI could not answer from local transaction data.")
		return jsonify({
			"error": {
				"code": "assistant_unavailable",
				"message": "Your local transaction data is temporarily unavailable.",
			}
		}), 503


@app.get("/api/transactions")
def transactions_list():
	"""Search, filter, and sort records in the database."""
	try:
		return jsonify({"data": list_transactions(request.args)}), 200
	except TransactionInputError as exc:
		return jsonify({
			"error": {"code": "invalid_filter", "message": str(exc)}
		}), 400
	except (RuntimeError, sqlite3.Error):
		app.logger.exception("PayPlus AI could not load transactions.")
		return jsonify({
			"error": {
				"code": "transactions_unavailable",
				"message": "Transactions are temporarily unavailable.",
			}
		}), 503


@app.get("/api/transactions/<int:transaction_id>")
def transaction_details(transaction_id: int):
	"""Return all stored details for one transaction."""
	try:
		transaction = get_transaction(transaction_id)
	except RuntimeError:
		app.logger.exception("PayPlus AI could not load transaction details.")
		return jsonify({
			"error": {
				"code": "transaction_unavailable",
				"message": "Transaction details are temporarily unavailable.",
			}
		}), 503
	if transaction is None:
		return jsonify({
			"error": {"code": "not_found", "message": "Transaction not found."}
		}), 404
	try:
		with closing(get_db_connection()) as connection:
			risk_data = score_transactions(connection, limit=0)
		transaction_risk = next(
			(item for item in risk_data["recent_transactions"] if item["id"] == transaction_id),
			None,
		)
	except (RuntimeError, sqlite3.Error):
		transaction_risk = None
	if transaction_risk:
		transaction = {
			**transaction,
			"risk_score": transaction_risk["risk_score"],
			"risk_level": transaction_risk["risk_level"],
			"risk_reasons": transaction_risk["risk_reasons"],
		}
	return jsonify({"data": transaction}), 200


@app.post("/api/transactions/import")
def transactions_import():
	"""Validate and import a CSV without saving the uploaded file."""
	upload = request.files.get("file")
	if upload is None or not upload.filename:
		return jsonify({
			"error": {"code": "file_required", "message": "Choose a CSV file to import."}
		}), 400
	try:
		result = import_transactions_csv(upload.filename, upload.read(MAX_CSV_BYTES + 1))
	except TransactionInputError as exc:
		return jsonify({
			"error": {"code": "invalid_csv", "message": str(exc)}
		}), 400
	except RuntimeError:
		app.logger.exception("PayPlus AI could not import CSV transactions.")
		return jsonify({
			"error": {
				"code": "import_unavailable",
				"message": "The file could not be imported. Your existing records were not changed.",
			}
		}), 503
	return jsonify({"data": result}), 200


@app.errorhandler(RequestEntityTooLarge)
def upload_too_large(_error):
	"""Return a readable response when a request exceeds the upload limit."""
	del _error
	return jsonify({
		"error": {
			"code": "file_too_large",
			"message": "CSV files must be 2 MB or smaller.",
		}
	}), 413


@app.get("/api/analytics")
def analytics_summary():
	"""Return date-bucketed, currency-separated analytics from SQLite."""
	try:
		return jsonify({"data": get_analytics_summary(request.args)}), 200
	except AnalyticsInputError as exc:
		return jsonify({
			"error": {"code": "invalid_analytics_range", "message": str(exc)}
		}), 400
	except (RuntimeError, sqlite3.Error):
		app.logger.exception("PayPlus AI could not calculate analytics.")
		return jsonify({
			"error": {
				"code": "analytics_unavailable",
				"message": "Analytics are temporarily unavailable.",
			}
		}), 503


@app.get("/api/security/summary")
def security_summary():
	"""Return local, explainable risk scores for saved transactions."""
	try:
		with closing(get_db_connection()) as connection:
			security = score_transactions(connection)
	except (RuntimeError, sqlite3.Error):
		app.logger.exception("PayPlus AI could not load the security overview.")
		return jsonify({
			"error": {
				"code": "security_summary_unavailable",
				"message": "Security overview data is temporarily unavailable.",
			}
		}), 503

	return jsonify({
		"data": {
			"risk_detection_available": True,
			"risk_detection_message": "Local screening scores records using explainable rules. Review alerts manually.",
			"alert_history_available": True,
			**security,
		},
	}), 200


@app.get("/api/dashboard/summary")
def dashboard_summary():
	"""Return dashboard figures derived from the existing transaction records."""
	try:
		return jsonify({"data": get_dashboard_summary()}), 200
	except (RuntimeError, sqlite3.Error):
		app.logger.exception("PayPlus AI could not load the dashboard summary.")
		return jsonify({
			"error": {
				"code": "dashboard_unavailable",
				"message": "Dashboard data is temporarily unavailable.",
			}
		}), 503


@app.get("/api/health")
def health_check():
	"""Report whether the application and its database are available."""
	try:
		with closing(get_db_connection()) as connection:
			connection.execute("SELECT 1").fetchone()
	except (RuntimeError, sqlite3.Error):
		app.logger.exception("PayPlus AI health check could not reach SQLite.")
		return jsonify({"status": "error", "database": "unavailable"}), 503

	return jsonify({"status": "ok", "database": "connected"}), 200


@app.get("/api/paypal/status")
def paypal_status():
	"""Report PayPal configuration status without exposing credentials."""
	settings = load_paypal_settings()
	return jsonify({
		"data": {
			"configured": settings.configured,
			"sandbox": "sandbox" in settings.base_url.casefold(),
			"base_url": settings.base_url,
		}
	}), 200


@app.post("/api/paypal/sync")
def paypal_sync():
	"""Fetch and import a validated PayPal transaction date range."""
	settings = load_paypal_settings()
	if not settings.configured:
		return jsonify({
			"error": {
				"code": "paypal_not_configured",
				"message": "PayPal credentials are not configured in .env.",
			}
		}), 503
	payload = request.get_json(silent=True) or {}
	start_date = str(payload.get("start_date", "")).strip()
	end_date = str(payload.get("end_date", "")).strip()
	try:
		start = date.fromisoformat(start_date)
		end = date.fromisoformat(end_date)
	except ValueError:
		return jsonify({
			"error": {"code": "invalid_date_range", "message": "Use YYYY-MM-DD dates."}
		}), 400
	if start > end or (end - start).days > 31:
		return jsonify({
			"error": {"code": "invalid_date_range", "message": "Choose a range from 0 to 31 days."}
		}), 400
	try:
		paypal_payload = PayPalClient(settings).get_transaction_report(
			f"{start_date}T00:00:00Z",
			f"{end_date}T23:59:59Z",
		)
		result = import_transactions_csv(
			"paypal-sync.csv",
			transaction_report_to_csv(paypal_payload),
			source="paypal",
		)
	except PayPalConfigurationError as exc:
		return jsonify({"error": {"code": "paypal_not_configured", "message": str(exc)}}), 503
	except PayPalAPIError:
		app.logger.exception("PayPal transaction sync failed.")
		return jsonify({
			"error": {"code": "paypal_sync_failed", "message": "PayPal could not provide the requested transactions."}
		}), 502
	except TransactionInputError as exc:
		return jsonify({"error": {"code": "paypal_data_invalid", "message": str(exc)}}), 502
	return jsonify({"data": result}), 200


if __name__ == "__main__":
	debug_enabled = os.getenv("FLASK_DEBUG", "false").strip().lower() in {
		"1",
		"true",
		"yes",
	}
	app.run(host="127.0.0.1", port=5000, debug=debug_enabled)
