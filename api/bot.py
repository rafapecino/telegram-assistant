"""Respuestas del bot a cada mensaje de Telegram."""

from datetime import datetime

from api.bank_connection import create_bank_link
from api.madrid_time import format_madrid_datetime
from api.reminders import create_reminder, interpret_reminder

HELP_TEXT = "\n".join([
    "Esto es lo que sé hacer:",
    '• Recordatorios: escribe, por ejemplo, "recuérdame llamar a Juan el jueves a las 17:00".',
    "• /conectar_banco: conecta tu cuenta del banco para importar los gastos cada día a las 8:00.",
    "• Los domingos a las 20:00 te mando el resumen de gastos de la semana.",
])


def _reply_to_reminder_request(text: str, now: datetime) -> str:
    interpretation = interpret_reminder(text, now)
    if interpretation.kind == "not_reminder":
        return f"No te he entendido.\n\n{HELP_TEXT}"
    if interpretation.kind == "invalid":
        return f"No he creado el recordatorio: {interpretation.reason}."
    create_reminder(interpretation.text, interpretation.remind_at)
    return f'Te recordaré "{interpretation.text}" el {format_madrid_datetime(interpretation.remind_at)}.'


def build_reply(text: str, now: datetime) -> str:
    if text in ("/start", "/ayuda"):
        return HELP_TEXT
    if text == "/conectar_banco":
        return f"Autoriza el acceso desde tu banco en este enlace (caduca en 30 minutos):\n{create_bank_link(now)}"
    return _reply_to_reminder_request(text, now)
