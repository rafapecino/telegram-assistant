"""Gastos: importa los movimientos del banco, los clasifica con la IA y los resume."""

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from api.bank_connection import get_active_bank_session
from api.db import connect
from api.enable_banking import fetch_transactions
from api.groq import ask_groq_for_json
from api.madrid_time import madrid_date_days_ago
from api.models import BankTransaction, CategoryAnswer, DailyTotal, ExpenseOut, ExpenseSummary
from api.telegram import send_telegram_message

logger = logging.getLogger(__name__)

EXPENSE_CATEGORIES = [
    "Supermercado",
    "Restaurantes",
    "Transporte",
    "Hogar",
    "Suscripciones",
    "Ocio",
    "Salud",
    "Compras",
    "Otros",
]

# Los bancos tardan varios días en asentar algunos cargos; la ventana se solapa y los duplicados se descartan.
IMPORT_WINDOW_DAYS = 7
LARGEST_EXPENSES_SHOWN = 3


@dataclass(frozen=True)
class NewExpense:
    bank_transaction_id: str
    account_uid: str
    booking_date: date
    amount: Decimal
    currency: str
    description: str


@dataclass(frozen=True)
class StoredExpense:
    booking_date: date
    amount: Decimal
    description: str
    category: str
    id: int | None = None


def to_new_expense(transaction: BankTransaction, account_uid: str) -> NewExpense | None:
    """Convierte un movimiento del banco en gasto. Ingresos y movimientos sin asentar se ignoran."""
    if transaction.status != "BOOK" or transaction.credit_debit_indicator != "DBIT":
        return None
    booking_date = transaction.booking_date or transaction.value_date or transaction.transaction_date
    if not booking_date:
        raise ValueError(f"Movimiento sin fecha: {transaction.model_dump_json()}")
    amount = abs(transaction.transaction_amount.amount)
    creditor_name = transaction.creditor.name if transaction.creditor else None
    description = creditor_name or " ".join(transaction.remittance_information or []) or "Sin descripción"
    # Si el banco no da identificador, se construye uno con los datos del cargo.
    bank_transaction_id = (
        transaction.entry_reference
        or transaction.transaction_id
        or f"{account_uid}|{booking_date}|{format(amount.normalize(), 'f')}|{description}"
    )
    return NewExpense(
        bank_transaction_id=bank_transaction_id,
        account_uid=account_uid,
        booking_date=date.fromisoformat(booking_date),
        amount=amount,
        currency=transaction.transaction_amount.currency,
        description=description,
    )


def build_categorization_prompt() -> str:
    return "\n".join([
        f"Clasifica cada gasto bancario en una de estas categorías: {', '.join(EXPENSE_CATEGORIES)}.",
        "Recibirás una lista JSON de gastos con su descripción e importe.",
        'Responde solo con JSON {"categories": [...]}: una categoría por gasto, en el mismo orden.',
    ])


def parse_categories(raw: Any, expected_count: int) -> list[str]:
    """Una categoría fuera de la lista se guarda como "Otros" para que el resumen agrupe siempre igual."""
    try:
        categories = CategoryAnswer.model_validate(raw).categories
    except ValueError:
        categories = []
    if len(categories) != expected_count:
        raise ValueError(f"Groq no devolvió una categoría por gasto (esperaba {expected_count}).")
    unknown = sum(1 for category in categories if category not in EXPENSE_CATEGORIES)
    if unknown:
        logger.warning("Groq devolvió %d categoría(s) fuera de la lista: se guardan como Otros", unknown)
    return [category if category in EXPENSE_CATEGORIES else "Otros" for category in categories]


def _categorize_expenses(expenses: list[NewExpense]) -> list[str]:
    items = [{"descripcion": expense.description, "importe": float(expense.amount)} for expense in expenses]
    raw = ask_groq_for_json(build_categorization_prompt(), json.dumps(items, ensure_ascii=False))
    return parse_categories(raw, len(expenses))


def _exclude_already_imported(candidates: list[NewExpense]) -> list[NewExpense]:
    unique_candidates = list({expense.bank_transaction_id: expense for expense in candidates}.values())
    if not unique_candidates:
        return []
    with connect() as connection:
        rows = connection.execute(
            "select bank_transaction_id from expenses where bank_transaction_id = any(%s)",
            ([expense.bank_transaction_id for expense in unique_candidates],),
        ).fetchall()
    imported_ids = {row["bank_transaction_id"] for row in rows}
    return [expense for expense in unique_candidates if expense.bank_transaction_id not in imported_ids]


def _fetch_candidate_expenses(account_uids: list[str], date_from: str) -> list[NewExpense]:
    candidates: list[NewExpense] = []
    for account_uid in account_uids:
        for transaction in fetch_transactions(account_uid, date_from):
            expense = to_new_expense(transaction, account_uid)
            if expense is not None:
                candidates.append(expense)
    return candidates


def import_recent_expenses(now: datetime) -> int:
    """Importa los gastos recientes del banco, los clasifica y devuelve cuántos eran nuevos."""
    session = get_active_bank_session(now)
    if session is None:
        raise RuntimeError("No hay ninguna conexión con el banco activa. Conéctalo con /conectar_banco.")
    candidates = _fetch_candidate_expenses(session.account_uids, madrid_date_days_ago(now, IMPORT_WINDOW_DAYS))
    new_expenses = _exclude_already_imported(candidates)
    # Solo contadores: descripciones, importes y cuentas son datos financieros personales.
    logger.info(
        "Importación de gastos: %d cuenta(s), %d cargos en los últimos %d días, %d nuevos",
        len(session.account_uids),
        len(candidates),
        IMPORT_WINDOW_DAYS,
        len(new_expenses),
    )
    if not new_expenses:
        return 0

    categories = _categorize_expenses(new_expenses)
    with connect() as connection, connection.cursor() as cursor:
        cursor.executemany(
            "insert into expenses (bank_transaction_id, account_uid, booking_date, amount, currency, description, category)"
            " values (%s, %s, %s, %s, %s, %s, %s) on conflict (bank_transaction_id) do nothing",
            [
                (e.bank_transaction_id, e.account_uid, e.booking_date, e.amount, e.currency, e.description, category)
                for e, category in zip(new_expenses, categories, strict=True)
            ],
        )
    logger.info("Guardados %d gastos clasificados", len(new_expenses))
    return len(new_expenses)


def fetch_expenses_since(date_from: str) -> list[StoredExpense]:
    with connect() as connection:
        rows = connection.execute(
            "select id, booking_date, amount, description, category from expenses where booking_date >= %s",
            (date_from,),
        ).fetchall()
    return [StoredExpense(**row) for row in rows]


# La cuenta es en euros; si algún día hay varias divisas, el total habría que separarlo por divisa.
def format_euros(amount: Decimal) -> str:
    """Formato español: 1.234,50 € (con espacio no separable antes del símbolo)."""
    spanish = f"{amount:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{spanish} €"


def _totals_by_category(expenses: list[StoredExpense]) -> list[tuple[str, Decimal]]:
    totals: dict[str, Decimal] = {}
    for expense in expenses:
        totals[expense.category] = totals.get(expense.category, Decimal(0)) + expense.amount
    return sorted(totals.items(), key=lambda item: item[1], reverse=True)


def _largest(expenses: list[StoredExpense]) -> list[StoredExpense]:
    return sorted(expenses, key=lambda expense: expense.amount, reverse=True)[:LARGEST_EXPENSES_SHOWN]


def build_weekly_summary(expenses: list[StoredExpense]) -> str:
    if not expenses:
        return "Resumen semanal: no hay gastos en los últimos 7 días."
    total = sum((expense.amount for expense in expenses), Decimal(0))
    category_lines = [f"• {category}: {format_euros(amount)}" for category, amount in _totals_by_category(expenses)]
    largest_lines = [
        f"• {expense.description}: {format_euros(expense.amount)} ({expense.booking_date.isoformat()})"
        for expense in _largest(expenses)
    ]
    return "\n".join([
        f"Resumen semanal: {format_euros(total)} en {len(expenses)} gastos.",
        "",
        "Por categoría:",
        *category_lines,
        "",
        "Gastos más grandes:",
        *largest_lines,
    ])


def send_weekly_summary(now: datetime) -> None:
    expenses = fetch_expenses_since(madrid_date_days_ago(now, 6))
    send_telegram_message(build_weekly_summary(expenses))
    logger.info("Resumen semanal enviado (%d gastos)", len(expenses))


def build_expense_summary(expenses: list[StoredExpense], days: int, today: date) -> ExpenseSummary:
    """Resumen de los `days` días que acaban en `today` (incluido), comparado con los `days` días anteriores.

    `expenses` puede traer gastos de antes del periodo anterior: se ignoran.
    """
    first_day = today - timedelta(days=days - 1)
    previous_first_day = first_day - timedelta(days=days)
    current = [expense for expense in expenses if first_day <= expense.booking_date <= today]
    previous = [expense for expense in expenses if previous_first_day <= expense.booking_date < first_day]

    daily = {first_day + timedelta(days=offset): Decimal(0) for offset in range(days)}
    for expense in current:
        daily[expense.booking_date] += expense.amount

    return ExpenseSummary(
        days=days,
        total=float(sum((expense.amount for expense in current), Decimal(0))),
        previous_total=float(sum((expense.amount for expense in previous), Decimal(0))),
        count=len(current),
        by_category={category: float(amount) for category, amount in _totals_by_category(current)},
        by_day=[DailyTotal(date=day, amount=float(amount)) for day, amount in daily.items()],
        categories=EXPENSE_CATEGORIES,
        largest=[
            ExpenseOut(
                id=expense.id,
                booking_date=expense.booking_date,
                amount=float(expense.amount),
                description=expense.description,
                category=expense.category,
            )
            for expense in _largest(current)
        ],
    )


def get_expense_summary(days: int, now: datetime) -> ExpenseSummary:
    """Resumen de los últimos `days` días (incluido hoy) para el frontend."""
    expenses = fetch_expenses_since(madrid_date_days_ago(now, 2 * days - 1))
    return build_expense_summary(expenses, days, date.fromisoformat(madrid_date_days_ago(now, 0)))


def update_expense_category(expense_id: int, category: str) -> bool:
    """Cambia la categoría de un gasto. Devuelve False si el gasto no existe."""
    with connect() as connection:
        row = connection.execute(
            "update expenses set category = %s where id = %s returning id", (category, expense_id)
        ).fetchone()
    if row:
        logger.info("Gasto %s pasado a %s", expense_id, category)
    return row is not None
