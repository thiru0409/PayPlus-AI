# PayPlus AI

PayPlus AI is a local Flask application for payment and order analytics.

## Run locally

In PowerShell, from the project folder, run:

```powershell
& '.\.venv\Scripts\python.exe' app.py
```

Open these pages in your browser:

- Overview: http://127.0.0.1:5000/
- Transactions: http://127.0.0.1:5000/transactions
- Analytics: http://127.0.0.1:5000/analytics
- Security & Risk: http://127.0.0.1:5000/security
- Financial Assistant: http://127.0.0.1:5000/assistant
- Personalize Dashboard: http://127.0.0.1:5000/settings
- Health check: http://127.0.0.1:5000/api/health

Press Ctrl+C in the terminal to stop the server.

## Current setup

- Flask loads local settings from `.env` when the application starts.
- SQLite creates `instance/payplus.db` automatically and prepares the initial transactions table.
- Transactions can be searched, filtered, sorted, reviewed, and imported from CSV.
- CSV files require `transaction_date`, `description`, `amount`, and `currency`; `category` is optional.
- A synthetic evaluation file is available at `sample_data/sample_transactions.csv` for a safe first import.
- Analytics are calculated from saved transactions. Currency totals are kept separate.
- Security & Risk uses a local, explainable screening model. It scores unusually large amounts, duplicate same-day records, high same-day volume, and descriptions needing manual review. Scores are informational and do not confirm fraud.
- The Assistant answers supported questions with rule-based summaries of local records. The risk model also runs locally; no external AI provider is configured, and neither feature provides financial advice.
- The PayPlus Pet is available as a floating assistant on every page. It keeps finance questions and adds token-light product discovery links across global marketplaces; PayPal availability must be confirmed at each seller's checkout.
- Appearance, layout, widget, chart, and accessibility preferences are saved in this browser only. They are not synced to other devices.
- The application has no PayPal connection yet. Use CSV imports for records from other platforms.
- PayPal sandbox connection and duplicate-safe transaction sync are available through `/api/paypal/sync`; the sync remains inactive until credentials are supplied in the ignored `.env` file. Check `/api/paypal/status` to see configuration status without exposing secrets.
- Run `python -m unittest discover -s tests` to verify the local risk model.
- Keep real credentials in the ignored `.env` file. `.env.example` contains placeholders only.
