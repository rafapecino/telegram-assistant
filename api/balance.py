"""Balance del panel: ingresos frente a gastos de cada mes.

Los ingresos los importa el bot de Supabase desde que se añadió el balance. En los meses anteriores no hay datos de
ingresos, así que no se calcula un ahorro (sería el gasto en negativo y engañaría).
"""

import calendar
from datetime import date, datetime
from decimal import Decimal

from api.db import connect
from api.madrid_time import madrid_date_days_ago
from api.models import BalanceMonth, BalanceSummary

Movement = tuple[date, Decimal]


def months_back(today: date, months: int) -> list[str]:
    """Los `months` meses que acaban en el de `today`, del más antiguo al más reciente: ["2026-05", ..., "2026-10"]."""
    keys = []
    year, month = today.year, today.month
    for _ in range(months):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return list(reversed(keys))


def _month_totals(movements: list[Movement], keys: list[str]) -> dict[str, Decimal]:
    totals = {key: Decimal(0) for key in keys}
    for day, amount in movements:
        key = f"{day.year:04d}-{day.month:02d}"
        if key in totals:
            totals[key] += amount
    return totals


def _month_end(key: str) -> date:
    year, month = (int(part) for part in key.split("-"))
    return date(year, month, calendar.monthrange(year, month)[1])


def build_balance(
    incomes: list[Movement], expenses: list[Movement], months: int, today: date, incomes_since: date | None
) -> BalanceSummary:
    keys = months_back(today, months)
    income_totals = _month_totals(incomes, keys)
    expense_totals = _month_totals(expenses, keys)
    result = []
    for key in keys:
        has_incomes = incomes_since is not None and _month_end(key) >= incomes_since
        income = income_totals[key] if has_incomes else None
        result.append(BalanceMonth(
            month=key,
            incomes=float(income) if income is not None else None,
            expenses=float(expense_totals[key]),
            savings=float(income - expense_totals[key]) if income is not None else None,
        ))
    return BalanceSummary(months=result, incomes_since=incomes_since)


def get_balance(months: int, now: datetime) -> BalanceSummary:
    today = date.fromisoformat(madrid_date_days_ago(now, 0))
    first_day = f"{months_back(today, months)[0]}-01"
    with connect() as connection:
        incomes = connection.execute(
            "select booking_date, amount from incomes where booking_date >= %s", (first_day,)
        ).fetchall()
        expenses = connection.execute(
            "select booking_date, amount from expenses where booking_date >= %s", (first_day,)
        ).fetchall()
        since = connection.execute("select min(booking_date) as since from incomes").fetchone()["since"]
    return build_balance(
        [(row["booking_date"], row["amount"]) for row in incomes],
        [(row["booking_date"], row["amount"]) for row in expenses],
        months,
        today,
        since,
    )
