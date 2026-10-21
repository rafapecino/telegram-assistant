"""Configuración de los logs: formato común, ID de petición y ocultación de secretos.

Regla de la aplicación: los logs llevan contadores, IDs internos y estados, nunca datos personales (texto de los
mensajes, descripciones o importes de gastos, cuentas del banco) ni secretos.
"""

import logging
import os
import re
from contextvars import ContextVar

# ID corto de la petición HTTP en curso, para seguir en los logs todo lo que pasa en una misma llamada.
# Las tareas programadas no tienen petición y salen con "-".
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# Variables de entorno cuyo valor nunca debe aparecer en un log.
SECRET_ENV_VARS = (
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "INTERNAL_SECRET",
    "PANEL_TOKEN",
    "GROQ_API_KEY",
    "ENABLE_BANKING_PRIVATE_KEY",
    "DATABASE_URL",
)

# Patrones de secretos por si llegan por otra vía (por ejemplo, dentro del texto de una excepción).
SECRET_PATTERNS = (
    (re.compile(r"bot\d+:[\w-]+"), "bot<oculto>"),  # token de Telegram dentro de una URL
    (re.compile(r"(Bearer\s+)[\w.~+/=-]+", re.IGNORECASE), r"\1<oculto>"),
    (re.compile(r"(postgres(?:ql)?://[^:/\s]+:)[^@\s]+@"), r"\1<oculto>@"),  # contraseña en la cadena de conexión
    (re.compile(r"\b((?:code|state)=)[^&\s\"]+"), r"\1<oculto>"),  # parámetros de la vuelta del banco
)

LOG_FORMAT = "%(asctime)s %(levelname)-7s [%(request_id)s] %(name)s: %(message)s"


def redact(text: str) -> str:
    for name in SECRET_ENV_VARS:
        value = os.environ.get(name, "").strip()
        # Los valores muy cortos se saltan para no tachar trozos de texto normal por casualidad.
        if len(value) >= 8:
            text = text.replace(value, f"<{name} oculto>")
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class RedactingFormatter(logging.Formatter):
    """Oculta los secretos en el texto final, trazas de excepciones incluidas."""

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(RedactingFormatter(LOG_FORMAT))
    handler.addFilter(RequestIdFilter())
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), handlers=[handler], force=True)

    # Uvicorn tiene sus propios handlers: se les pone el mismo formato para que también oculten secretos.
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = [handler]
        uvicorn_logger.propagate = False
    # El log de acceso de uvicorn incluye la query (?code=...&state=... del banco). Lo sustituye el middleware
    # de api/main.py, que registra método, ruta, estado y duración sin la query.
    logging.getLogger("uvicorn.access").disabled = True
    # httpx registra cada URL en INFO, y la de Telegram lleva el token del bot.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    # APScheduler registra cada ejecución (la de recordatorios es cada minuto).
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
