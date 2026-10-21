"""Modelos Pydantic: validan lo que llega de Telegram, del banco y de la IA, y lo que devuelve la API."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

# --- Telegram ---


class TelegramUser(BaseModel):
    id: int


class TelegramMessage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str | None = None
    sender: TelegramUser | None = Field(default=None, alias="from")


class TelegramUpdate(BaseModel):
    message: TelegramMessage | None = None


# --- Banco (Enable Banking) ---


class BankAmount(BaseModel):
    amount: Decimal
    currency: str


class BankCreditor(BaseModel):
    name: str | None = None


class BankTransaction(BaseModel):
    entry_reference: str | None = None
    transaction_id: str | None = None
    transaction_amount: BankAmount
    credit_debit_indicator: Literal["CRDT", "DBIT"]
    status: str
    booking_date: str | None = None
    value_date: str | None = None
    transaction_date: str | None = None
    creditor: BankCreditor | None = None
    remittance_information: list[str] | None = None


class BankTransactionPage(BaseModel):
    transactions: list[BankTransaction]
    continuation_key: str | None = None


# --- Respuestas de la IA (Groq) ---


class ReminderAnswer(BaseModel):
    is_reminder: StrictBool
    text: str | None = None
    local_datetime: str | None = None


class CategoryAnswer(BaseModel):
    categories: list[str]


# --- API ---


class ReminderCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    remind_at: datetime

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("el texto no puede estar vacío")
        return value.strip()

    @field_validator("remind_at")
    @classmethod
    def remind_at_needs_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("indica la zona horaria (por ejemplo +02:00)")
        return value


class ReminderOut(BaseModel):
    id: int
    text: str
    remind_at: datetime


class ExpenseOut(BaseModel):
    id: int
    booking_date: date
    amount: float
    description: str
    category: str


class DailyTotal(BaseModel):
    date: date
    amount: float


class ExpenseSummary(BaseModel):
    days: int
    total: float
    # Total de los `days` días inmediatamente anteriores, para comparar.
    previous_total: float
    count: int
    by_category: dict[str, float]
    # Un elemento por día del periodo, en orden y con 0 los días sin gastos.
    by_day: list[DailyTotal]
    largest: list[ExpenseOut]
    # Categorías a las que se puede mover un gasto.
    categories: list[str]


class ExpenseCategoryUpdate(BaseModel):
    category: str


class JobResult(BaseModel):
    job: str
    result: str
