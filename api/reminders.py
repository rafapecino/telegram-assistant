"""Recordatorios: interpreta frases con la IA, los guarda y los envía cuando toca."""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import ValidationError

from api.db import connect
from api.groq import ask_groq_for_json
from api.madrid_time import MadridClock, madrid_clock, madrid_local_to_utc
from api.models import ReminderAnswer, ReminderOut
from api.telegram import send_telegram_message

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReminderInterpretation:
    kind: Literal["reminder", "not_reminder", "invalid"]
    text: str = ""
    remind_at: datetime | None = None
    reason: str = ""


NOT_REMINDER = ReminderInterpretation(kind="not_reminder")


def build_reminder_prompt(clock: MadridClock) -> str:
    return "\n".join([
        "Interpretas mensajes en español para un bot personal de recordatorios.",
        f"Ahora en Madrid es {clock.weekday} {clock.local_date_time}.",
        "Si el mensaje pide un recordatorio, responde solo con este JSON:",
        '{"is_reminder": true, "text": "<qué hay que recordar, breve>", "local_datetime": "YYYY-MM-DDTHH:mm"}',
        "local_datetime es la hora local de Madrid. Sin hora indicada, usa las 09:00.",
        'Si el mensaje no pide un recordatorio, responde solo {"is_reminder": false}.',
    ])


def parse_reminder_answer(raw: Any, now: datetime) -> ReminderInterpretation:
    """Valida la respuesta del modelo: puede equivocarse y no queremos guardar basura."""
    try:
        answer = ReminderAnswer.model_validate(raw)
    except ValidationError:
        return NOT_REMINDER
    if not answer.is_reminder:
        return NOT_REMINDER
    text = (answer.text or "").strip()
    if not text:
        return ReminderInterpretation(kind="invalid", reason="no he entendido qué quieres que te recuerde")
    try:
        remind_at = madrid_local_to_utc(answer.local_datetime or "")
    except ValueError:
        return ReminderInterpretation(kind="invalid", reason="no he entendido la fecha")
    if remind_at <= now:
        return ReminderInterpretation(kind="invalid", reason="la fecha que he entendido ya ha pasado")
    return ReminderInterpretation(kind="reminder", text=text, remind_at=remind_at)


def interpret_reminder(message: str, now: datetime) -> ReminderInterpretation:
    raw = ask_groq_for_json(build_reminder_prompt(madrid_clock(now)), message)
    interpretation = parse_reminder_answer(raw, now)
    logger.info("Mensaje interpretado como %s%s", interpretation.kind,
                f" ({interpretation.reason})" if interpretation.reason else "")
    return interpretation


def create_reminder(text: str, remind_at: datetime) -> int:
    with connect() as connection:
        row = connection.execute(
            "insert into reminders (text, remind_at) values (%s, %s) returning id", (text, remind_at)
        ).fetchone()
    # El texto del recordatorio no se registra: puede tener datos personales.
    logger.info("Recordatorio %s creado para %s", row["id"], remind_at.isoformat())
    return row["id"]


def list_pending_reminders() -> list[ReminderOut]:
    with connect() as connection:
        rows = connection.execute(
            "select id, text, remind_at from reminders where sent_at is null and completed_at is null "
            "order by remind_at limit 100"
        ).fetchall()
    return [ReminderOut(**row) for row in rows]


def complete_reminder(reminder_id: int, now: datetime) -> bool:
    """Marca un recordatorio pendiente como completado. Devuelve False si no existe o ya no está pendiente."""
    with connect() as connection:
        row = connection.execute(
            "update reminders set completed_at = %s where id = %s and sent_at is null and completed_at is null "
            "returning id",
            (now, reminder_id),
        ).fetchone()
    if row:
        logger.info("Recordatorio %s completado", reminder_id)
    return row is not None


def delete_reminder(reminder_id: int) -> bool:
    """Borra un recordatorio. Devuelve False si no existe."""
    with connect() as connection:
        row = connection.execute("delete from reminders where id = %s returning id", (reminder_id,)).fetchone()
    if row:
        logger.info("Recordatorio %s borrado", reminder_id)
    return row is not None


def _unmark_as_sent(reminder_ids: list[int]) -> None:
    with connect() as connection:
        connection.execute("update reminders set sent_at = null where id = any(%s)", (reminder_ids,))


def send_due_reminders(now: datetime) -> int:
    # Se marcan como enviados antes de enviarlos para que dos ejecuciones solapadas no los dupliquen.
    with connect() as connection:
        due_reminders = connection.execute(
            "update reminders set sent_at = %s where sent_at is null and completed_at is null and remind_at <= %s "
            "returning id, text",
            (now, now),
        ).fetchall()

    for index, reminder in enumerate(due_reminders):
        try:
            send_telegram_message(f"⏰ {reminder['text']}")
        except Exception:
            # Se desmarcan este y los que faltan para que el siguiente minuto los reintente.
            pending_ids = [pending["id"] for pending in due_reminders[index:]]
            _unmark_as_sent(pending_ids)
            logger.warning("Fallo al enviar recordatorios: %d quedan para el siguiente intento", len(pending_ids))
            raise
        logger.info("Recordatorio %s enviado", reminder["id"])
    return len(due_reminders)
