from datetime import date
from decimal import Decimal

import pytest

from api.expenses import NewExpense, StoredExpense, build_weekly_summary, parse_categories, to_new_expense
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
