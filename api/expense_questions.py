"""Preguntas sobre los gastos desde el chat del panel.

La IA solo interpreta la pregunta (periodo, categoría, comercio y orden). Las cifras salen de la base de datos, así que
el modelo nunca puede inventarse un importe.
"""

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import ValidationError

from api.db import connect
from api.expenses import EXPENSE_CATEGORIES, StoredExpense, format_euros, totals_by_category
from api.groq import ask_groq_for_json
from api.madrid_time import MONTHS, MadridClock, madrid_clock
from api.models import ExpenseAnswer, ExpenseOut, ExpenseQueryResult, ExpenseQuestionAnswer

logger = logging.getLogger(__name__)

# El chat enseña los primeros; el total y el desglose por categoría cuentan todos.
LISTED_EXPENSES = 10
SEARCH_MAX_LENGTH = 50

HELP_TEXT = (
    "Puedo decirte cuánto has gastado en un periodo, en una categoría o en un comercio, y cuáles fueron tus gastos "
    "más grandes. Prueba con «¿Cuánto he gastado este mes en restaurantes?»."
)
UNCLEAR_DATES_TEXT = "No he entendido de qué fechas quieres ver los gastos. Prueba con «este mes» o «del 1 al 15 de octubre»."


@dataclass(frozen=True)
class ExpenseQuery:
    date_from: date
    date_to: date
    category: str | None = None
    search: str | None = None
    order: Literal["date", "amount"] = "date"


@dataclass(frozen=True)
class QuestionInterpretation:
    kind: Literal["query", "unknown", "invalid"]
    query: ExpenseQuery | None = None
    reason: str = ""


UNKNOWN = QuestionInterpretation(kind="unknown")


def build_expense_question_prompt(clock: MadridClock) -> str:
    return "\n".join([
        "Interpretas preguntas en español sobre los gastos de una cuenta bancaria personal.",
        f"Ahora en Madrid es {clock.weekday} {clock.local_date_time}.",
        "Si la pregunta es sobre los gastos, responde solo con este JSON:",
        (
            '{"intent": "expenses_query", "date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD", '
            '"category": <categoría o null>, "search": <comercio o concepto o null>, "order": "date" o "amount"}'
        ),
        f"category es una de {json.dumps(EXPENSE_CATEGORIES, ensure_ascii=False)}, o null si no pregunta por una.",
        (
            'search es el comercio o concepto que busca ("Mercadona", "Amazon"), o null. '
            "Si encaja en una categoría, usa category y deja search en null."
        ),
        'order es "amount" si pregunta por los gastos más grandes o caros; si no, "date".',
        'Sin periodo indicado, los últimos 30 días hasta hoy. "Esta semana" empieza el lunes; "este mes", el día 1.',
        'Si hay preguntas anteriores, úsalas solo para completar lo que falte en la actual ("¿y el mes pasado?").',
        'Si la pregunta no es sobre los gastos, responde solo {"intent": "unknown"}.',
    ])


def build_question_message(question: str, previous_questions: list[str]) -> str:
    if not previous_questions:
        return question
    previous = "\n".join(f"- {text}" for text in previous_questions)
    return f"Preguntas anteriores:\n{previous}\n\nPregunta actual: {question}"


def parse_expense_question(raw: Any) -> QuestionInterpretation:
    """Valida la respuesta del modelo antes de consultar la base de datos: puede equivocarse."""
    if not isinstance(raw, dict) or raw.get("intent") != "expenses_query":
        return UNKNOWN
    try:
        answer = ExpenseQuestionAnswer.model_validate(raw)
    except ValidationError:
        return QuestionInterpretation(kind="invalid", reason=UNCLEAR_DATES_TEXT)
    if answer.date_from > answer.date_to:
        return QuestionInterpretation(kind="invalid", reason=UNCLEAR_DATES_TEXT)
    if answer.category is not None and answer.category not in EXPENSE_CATEGORIES:
        categories = ", ".join(EXPENSE_CATEGORIES)
        return QuestionInterpretation(
            kind="invalid", reason=f"No conozco la categoría «{answer.category}». Las que uso son: {categories}."
        )
    search = (answer.search or "").strip()[:SEARCH_MAX_LENGTH] or None
    order = "amount" if answer.order == "amount" else "date"
    query = ExpenseQuery(answer.date_from, answer.date_to, answer.category, search, order)
    return QuestionInterpretation(kind="query", query=query)


def interpret_expense_question(question: str, previous_questions: list[str], now: datetime) -> QuestionInterpretation:
    raw = ask_groq_for_json(
        build_expense_question_prompt(madrid_clock(now)), build_question_message(question, previous_questions)
    )
    interpretation = parse_expense_question(raw)
    # Ni la pregunta ni el comercio se registran: pueden tener datos personales.
    query = interpretation.query
    logger.info(
        "Pregunta de gastos interpretada como %s%s",
        interpretation.kind,
        f" ({(query.date_to - query.date_from).days + 1} días, categoría: {'sí' if query.category else 'no'}, "
        f"búsqueda: {'sí' if query.search else 'no'}, orden: {query.order})" if query else "",
    )
    return interpretation


def find_expenses(query: ExpenseQuery) -> list[StoredExpense]:
    conditions = ["booking_date between %s and %s"]
    params: list[Any] = [query.date_from, query.date_to]
    if query.category:
        conditions.append("category = %s")
        params.append(query.category)
    if query.search:
        # position() en vez de ilike: así % y _ del texto buscado no funcionan como comodines.
        conditions.append("position(lower(%s) in lower(description)) > 0")
        params.append(query.search)
    order_by = "amount desc, booking_date desc" if query.order == "amount" else "booking_date desc, amount desc"
    sql = (
        "select id, booking_date, amount, description, category from expenses"
        f" where {' and '.join(conditions)} order by {order_by}"
    )
    with connect() as connection:
        rows = connection.execute(sql, params).fetchall()
    return [StoredExpense(**row) for row in rows]


def describe_period(date_from: date, date_to: date) -> str:
    """Periodo en español: "el 21 de octubre", "del 1 al 21 de octubre", "del 28 de septiembre al 21 de octubre"."""
    def day_month(day: date) -> str:
        return f"{day.day} de {MONTHS[day.month - 1]}"

    if date_from == date_to:
        return f"el {day_month(date_to)}"
    if date_from.year != date_to.year:
        return f"del {day_month(date_from)} de {date_from.year} al {day_month(date_to)} de {date_to.year}"
    if date_from.month == date_to.month:
        return f"del {date_from.day} al {day_month(date_to)}"
    return f"del {day_month(date_from)} al {day_month(date_to)}"


def _describe_scope(query: ExpenseQuery) -> str:
    scope = describe_period(query.date_from, query.date_to)
    if query.category and query.search:
        return f"{scope} en {query.category} («{query.search}»)"
    if query.category:
        return f"{scope} en {query.category}"
    if query.search:
        return f"{scope} en «{query.search}»"
    return scope


def _headline(expenses: list[StoredExpense], total: Decimal, query: ExpenseQuery) -> str:
    scope = _describe_scope(query)
    if not expenses:
        return f"No tienes gastos {scope}."
    count = f"{len(expenses)} {'gasto' if len(expenses) == 1 else 'gastos'}"
    headline = f"Has gastado {format_euros(total)} {scope} ({count})."
    if query.order == "amount":
        largest = expenses[0]
        headline += f" El más grande: {largest.description}, {format_euros(largest.amount)}."
    return headline


def build_expense_answer(expenses: list[StoredExpense], query: ExpenseQuery) -> ExpenseAnswer:
    """Recibe los gastos ya filtrados y en el orden pedido, como los devuelve find_expenses."""
    total = sum((expense.amount for expense in expenses), Decimal(0))
    listed = expenses[:LISTED_EXPENSES]
    return ExpenseAnswer(
        text=_headline(expenses, total, query),
        result=ExpenseQueryResult(
            date_from=query.date_from,
            date_to=query.date_to,
            category=query.category,
            search=query.search,
            total=float(total),
            count=len(expenses),
            by_category={category: float(amount) for category, amount in totals_by_category(expenses)},
            expenses=[
                ExpenseOut(
                    id=expense.id,
                    booking_date=expense.booking_date,
                    amount=float(expense.amount),
                    description=expense.description,
                    category=expense.category,
                )
                for expense in listed
            ],
            unlisted_count=len(expenses) - len(listed),
        ),
    )


def answer_expense_question(interpretation: QuestionInterpretation) -> ExpenseAnswer:
    if interpretation.query is None:
        return ExpenseAnswer(text=interpretation.reason or HELP_TEXT)
    return build_expense_answer(find_expenses(interpretation.query), interpretation.query)
