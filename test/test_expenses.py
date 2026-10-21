from datetime import date
from decimal import Decimal

import pytest

from api.expenses import (
    NewExpense,
    StoredExpense,
    build_expense_summary,
    build_weekly_summary,
    parse_categories,
    to_new_expense,
)
from api.models import BankTransaction

CARD_PAYMENT = {
    "entry_reference": "ref-1",
    "transaction_amount": {"amount": "12.50", "currency": "EUR"},
    "credit_debit_indicator": "DBIT",
    "status": "BOOK",
    "booking_date": "2026-10-20",
    "creditor": {"name": "MERCADONA"},
    "remittance_information": ["COMPRA TARJETA"],
}


def transaction(**overrides) -> BankTransaction:
    return BankTransaction.model_validate({**CARD_PAYMENT, **overrides})


def test_convierte_un_cargo_asentado_en_gasto():
    assert to_new_expense(transaction(), "account-1") == NewExpense(
        bank_transaction_id="ref-1",
        account_uid="account-1",
        booking_date=date(2026, 10, 20),
        amount=Decimal("12.5"),
        currency="EUR",
        description="MERCADONA",
    )


def test_ignora_ingresos_y_movimientos_sin_asentar():
    assert to_new_expense(transaction(credit_debit_indicator="CRDT"), "account-1") is None
    assert to_new_expense(transaction(status="PDNG"), "account-1") is None


def test_sin_acreedor_usa_el_concepto_y_sin_identificador_construye_uno_estable():
    expense = to_new_expense(
        transaction(entry_reference=None, creditor=None, transaction_amount={"amount": "-3", "currency": "EUR"}),
        "account-1",
    )
    assert expense.description == "COMPRA TARJETA"
    assert expense.amount == Decimal("3")
    assert expense.bank_transaction_id == "account-1|2026-10-20|3|COMPRA TARJETA"


def test_las_categorias_desconocidas_pasan_a_otros():
    assert parse_categories({"categories": ["Supermercado", "Viajes"]}, 2) == ["Supermercado", "Otros"]


@pytest.mark.parametrize("raw", [{"categories": ["Supermercado"]}, "no es json", None])
def test_un_numero_incorrecto_de_categorias_falla(raw):
    with pytest.raises(ValueError):
        parse_categories(raw, 2)


def test_el_resumen_semanal_suma_por_categoria_y_muestra_los_mayores_gastos():
    summary = build_weekly_summary([
        StoredExpense(date(2026, 10, 19), Decimal("40"), "Gasolinera", "Transporte"),
        StoredExpense(date(2026, 10, 20), Decimal("12.5"), "MERCADONA", "Supermercado"),
        StoredExpense(date(2026, 10, 21), Decimal("7.5"), "LIDL", "Supermercado"),
    ])
    # El importe y el símbolo van separados por un espacio no separable.
    normalized = summary.replace(" ", " ")
    assert "3 gastos" in normalized
    assert "Transporte: 40,00 €" in normalized
    assert "Supermercado: 20,00 €" in normalized
    assert "Gasolinera: 40,00 € (2026-10-19)" in normalized


def test_el_resumen_avisa_si_no_hay_gastos():
    assert "no hay gastos" in build_weekly_summary([])


# --- Resumen del panel ---

TODAY = date(2026, 10, 21)


def stored(day: int, amount: str, category: str = "Ocio", expense_id: int = 1) -> StoredExpense:
    return StoredExpense(date(2026, 10, day), Decimal(amount), "Gasto", category, expense_id)


def test_el_resumen_del_panel_separa_el_periodo_actual_del_anterior():
    # Periodo de 7 días: 15-21 oct. Anterior: 8-14 oct. El día 7 queda fuera de los dos.
    summary = build_expense_summary(
        [stored(21, "10"), stored(15, "5"), stored(14, "3"), stored(8, "2"), stored(7, "100")], 7, TODAY
    )
    assert summary.total == 15
    assert summary.count == 2
    assert summary.previous_total == 5


def test_el_resumen_del_panel_sin_gastos_anteriores_compara_con_cero():
    summary = build_expense_summary([stored(20, "10")], 7, TODAY)
    assert summary.previous_total == 0


def test_el_resumen_del_panel_trae_un_total_por_dia_con_ceros():
    summary = build_expense_summary([stored(21, "10"), stored(21, "2.5"), stored(19, "4")], 7, TODAY)
    assert [(day.date.isoformat(), day.amount) for day in summary.by_day] == [
        ("2026-10-15", 0), ("2026-10-16", 0), ("2026-10-17", 0), ("2026-10-18", 0),
        ("2026-10-19", 4), ("2026-10-20", 0), ("2026-10-21", 12.5),
    ]


def test_el_resumen_del_panel_incluye_ids_y_categorias_validas():
    summary = build_expense_summary([stored(21, "10", expense_id=42)], 7, TODAY)
    assert summary.largest[0].id == 42
    assert "Supermercado" in summary.categories
