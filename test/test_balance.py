from datetime import date
from decimal import Decimal

from api.balance import build_balance, months_back

TODAY = date(2026, 10, 22)


def test_los_meses_acaban_en_el_actual_y_cruzan_el_cambio_de_ano():
    assert months_back(date(2026, 2, 10), 4) == ["2025-11", "2025-12", "2026-01", "2026-02"]


def test_suma_por_mes_y_calcula_el_ahorro():
    summary = build_balance(
        incomes=[(date(2026, 10, 1), Decimal("2000")), (date(2026, 10, 15), Decimal("100"))],
        expenses=[(date(2026, 10, 3), Decimal("1143.45")), (date(2026, 9, 30), Decimal("50"))],
        months=2,
        today=TODAY,
        incomes_since=date(2026, 9, 1),
    )
    assert [month.model_dump() for month in summary.months] == [
        {"month": "2026-09", "incomes": 0, "expenses": 50, "savings": -50},
        {"month": "2026-10", "incomes": 2100, "expenses": 1143.45, "savings": 956.55},
    ]


def test_antes_del_primer_ingreso_registrado_no_hay_ahorro_que_calcular():
    summary = build_balance(
        incomes=[(date(2026, 10, 20), Decimal("2000"))],
        expenses=[(date(2026, 9, 10), Decimal("80"))],
        months=2,
        today=TODAY,
        incomes_since=date(2026, 10, 20),
    )
    september, october = summary.months
    assert (september.incomes, september.expenses, september.savings) == (None, 80, None)
    assert october.savings == 2000


def test_sin_ningun_ingreso_todavia_ningun_mes_tiene_ahorro():
    summary = build_balance([], [(date(2026, 10, 1), Decimal("10"))], 1, TODAY, None)
    assert summary.incomes_since is None
    assert summary.months[0].savings is None


def test_ignora_movimientos_fuera_de_los_meses_pedidos():
    summary = build_balance([], [(date(2026, 1, 5), Decimal("999"))], 3, TODAY, None)
    assert [month.expenses for month in summary.months] == [0, 0, 0]
