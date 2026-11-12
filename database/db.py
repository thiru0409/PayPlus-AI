"""SQLite helpers for the PayWise AI application."""

from pathlib import Path
import sqlite3


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_PATH = PROJECT_ROOT / "instance" / "paywise.db"


def get_db_connection() -> sqlite3.Connection:
	"""Open a connection to the project database."""
	try:
		DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
		connection = sqlite3.connect(DATABASE_PATH, timeout=10)
	except (OSError, sqlite3.Error) as exc:
		raise RuntimeError("Could not connect to the PayWise AI database.") from exc

	connection.row_factory = sqlite3.Row
	return connection


def init_db() -> None:
	"""Create the initial transaction table if it does not exist."""
	connection = get_db_connection()
	try:
		connection.executescript(
			"""
			CREATE TABLE IF NOT EXISTS transactions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				transaction_date TEXT NOT NULL,
				description TEXT NOT NULL,
				amount REAL NOT NULL,
				currency TEXT NOT NULL DEFAULT 'USD',
				category TEXT NOT NULL DEFAULT 'uncategorized',
				source TEXT NOT NULL DEFAULT 'csv',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			"""
		)
		connection.commit()
	except sqlite3.Error as exc:
		raise RuntimeError("Could not initialize the PayWise AI database.") from exc
	finally:
		connection.close()
