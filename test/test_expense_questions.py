from datetime import date
from decimal import Decimal

import pytest

from api import expense_questions
from api.expense_questions import (
    HELP_TEXT,
    LISTED_EXPENSES,
    ExpenseQuery,
    QuestionInterpretation,
    answer_expense_question,
    build_expense_answer,
    build_question_message,
    describe_period,
    parse_expense_question,
)
from api.expenses import StoredExpense

QUERY = {"intent": "expenses_query", "date_from": "2026-10-01", "date_to": "2026-10-21"}


def test_acepta_una_consulta_valida():
    result = parse_expense_question({**QUERY, "category": "Ocio", "search": " Cines ", "order": "amount"})
    assert result.kind == "query"
    assert result.query == ExpenseQuery(date(2026, 10, 1), date(2026, 10, 21), "Ocio", "Cines", "amount")


def test_sin_categoria_ni_orden_valido_ordena_por_fecha():
    result = parse_expense_question({**QUERY, "category": None, "search": "", "order": "importe"})
    assert result.query == ExpenseQuery(date(2026, 10, 1), date(2026, 10, 21), None, None, "date")


@pytest.mark.parametrize("raw", [{"intent": "unknown"}, {"date_from": "2026-10-01"}, None, "texto", []])
def test_lo_que_no_es_una_consulta_de_gastos_se_marca_como_desconocido(raw):
    assert parse_expense_question(raw).kind == "unknown"


@pytest.mark.parametrize(
    "overrides",
    [
        {"date_from": "2026-10-22"},  # empieza después de acabar
        {"date_to": "el jueves"},
        {"date_from": "2026-02-30"},
        {"date_to": None},
    ],
)
def test_rechaza_fechas_que_no_se_entienden(overrides):
    result = parse_expense_question({**QUERY, **overrides})
    assert result.kind == "invalid"
    assert "fechas" in result.reason


def test_rechaza_categorias_que_no_existen_y_dice_cuales_hay():
    result = parse_expense_question({**QUERY, "category": "Viajes"})
    assert result.kind == "invalid"
    assert "Viajes" in result.reason and "Supermercado" in result.reason


def test_la_busqueda_se_recorta_a_50_caracteres():
    result = parse_expense_question({**QUERY, "search": "x" * 80})
    assert result.query.search == "x" * 50


def test_las_preguntas_anteriores_van_como_contexto():
    assert build_question_message("¿Y el mes pasado?", []) == "¿Y el mes pasado?"
    message = build_question_message("¿Y el mes pasado?", ["¿Cuánto en restaurantes este mes?"])
    assert message.startswith("Preguntas anteriores:\n- ¿Cuánto en restaurantes este mes?")
    assert message.endswith("Pregunta actual: ¿Y el mes pasado?")


@pytest.mark.parametrize(
    ("date_from", "date_to", "expected"),
    [
        (date(2026, 10, 21), date(2026, 10, 21), "el 21 de octubre"),
        (date(2026, 10, 1), date(2026, 10, 21), "del 1 al 21 de octubre"),
        (date(2026, 9, 28), date(2026, 10, 4), "del 28 de septiembre al 4 de octubre"),
        (date(2025, 12, 29), date(2026, 1, 4), "del 29 de diciembre de 2025 al 4 de enero de 2026"),
    ],
)
def test_describe_el_periodo_en_espanol(date_from, date_to, expected):
    assert describe_period(date_from, date_to) == expected


def stored(day: int, amount: str, description: str = "Gasto", category: str = "Ocio", expense_id: int = 1):
    return StoredExpense(date(2026, 10, day), Decimal(amount), description, category, expense_id)


OCTOBER = ExpenseQuery(date(2026, 10, 1), date(2026, 10, 21))


def test_la_respuesta_suma_desglosa_y_titula_con_el_periodo():
    answer = build_expense_answer(
        [stored(21, "10", category="Ocio"), stored(20, "30.5", category="Restaurantes"), stored(3, "2", category="Ocio")],
        OCTOBER,
    )
    assert answer.text.replace("\xa0", " ") == "Has gastado 42,50 € del 1 al 21 de octubre (3 gastos)."
    assert answer.result.total == 42.5
    assert answer.result.count == 3
    assert answer.result.by_category == {"Restaurantes": 30.5, "Ocio": 12}


def test_la_respuesta_nombra_categoria_y_comercio():
    query = ExpenseQuery(date(2026, 10, 1), date(2026, 10, 21), "Supermercado", "Mercadona")
    answer = build_expense_answer([stored(5, "12.5", "MERCADONA", "Supermercado")], query)
    assert "en Supermercado («Mercadona») (1 gasto)." in answer.text


def test_ordenado_por_importe_destaca_el_mas_grande():
    query = ExpenseQuery(date(2026, 10, 1), date(2026, 10, 21), order="amount")
    answer = build_expense_answer([stored(9, "80", "Zapatos"), stored(2, "5")], query)
    assert answer.text.replace("\xa0", " ").endswith("El más grande: Zapatos, 80,00 €.")


def test_sin_gastos_lo_dice():
    answer = build_expense_answer([], ExpenseQuery(date(2026, 10, 21), date(2026, 10, 21), "Salud"))
    assert answer.text == "No tienes gastos el 21 de octubre en Salud."
    assert answer.result.count == 0


def test_solo_lista_los_primeros_gastos_pero_suma_todos():
    expenses = [stored(1, "1", expense_id=index) for index in range(LISTED_EXPENSES + 3)]
    answer = build_expense_answer(expenses, OCTOBER)
    assert len(answer.result.expenses) == LISTED_EXPENSES
    assert answer.result.unlisted_count == 3
    assert answer.result.count == LISTED_EXPENSES + 3


def test_si_no_hay_consulta_responde_con_el_motivo_o_la_ayuda():
    assert answer_expense_question(QuestionInterpretation(kind="unknown")).text == HELP_TEXT
    invalid = answer_expense_question(QuestionInterpretation(kind="invalid", reason="No te entiendo."))
    assert invalid.text == "No te entiendo."
    assert invalid.result is None


class FakeConnection:
    def __init__(self):
        self.executed: list[tuple[str, list]] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def execute(self, sql, params):
        self.executed.append((sql, params))
        return self

    def fetchall(self):
        return [{"id": 7, "booking_date": date(2026, 10, 5), "amount": Decimal("12.5"), "description": "MERCADONA",
                 "category": "Supermercado"}]


def test_la_consulta_filtra_con_parametros_y_ordena_segun_lo_pedido(monkeypatch):
    connection = FakeConnection()
    monkeypatch.setattr(expense_questions, "connect", lambda: connection)
    query = ExpenseQuery(date(2026, 10, 1), date(2026, 10, 21), "Supermercado", "50%_off", "amount")
    expenses = expense_questions.find_expenses(query)

    sql, params = connection.executed[0]
    assert params == [date(2026, 10, 1), date(2026, 10, 21), "Supermercado", "50%_off"]
    assert sql.count("%s") == len(params)
    assert "position(lower(%s) in lower(description))" in sql and "ilike" not in sql
    assert sql.endswith("order by amount desc, booking_date desc")
    assert expenses == [StoredExpense(date(2026, 10, 5), Decimal("12.5"), "MERCADONA", "Supermercado", 7)]
