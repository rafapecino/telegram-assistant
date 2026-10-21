"""Tareas programadas (sustituyen a pg_cron) que también se pueden lanzar a mano desde la API."""

import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from api.expenses import import_recent_expenses, send_weekly_summary
from api.logging_config import redact
from api.reminders import send_due_reminders
from api.telegram import send_telegram_message

logger = logging.getLogger(__name__)

MADRID_TIMEZONE = "Europe/Madrid"
DAILY_IMPORT_HOUR = 8
WEEKLY_SUMMARY_HOUR = 20


# Tareas tan frecuentes que su resultado va en DEBUG (el módulo avisa en INFO cuando hace algo, por ejemplo al
# enviar un recordatorio).
QUIET_JOBS = {"reminders"}


class UnknownJobError(Exception):
    pass


def _import_and_summarize(now: datetime) -> str:
    imported_count = import_recent_expenses(now)
    send_weekly_summary(now)
    return f"Importados {imported_count} gastos y enviado el resumen"


JOBS: dict[str, Callable[[datetime], str]] = {
    "reminders": lambda now: f"Enviados {send_due_reminders(now)} recordatorios",
    "import-expenses": lambda now: f"Importados {import_recent_expenses(now)} gastos",
    "weekly-summary": _import_and_summarize,
}


def run_and_report(name: str) -> str:
    """Ejecuta la tarea y, si falla, avisa por Telegram antes de propagar el error."""
    if name not in JOBS:
        raise UnknownJobError(name)
    started = time.perf_counter()
    try:
        result = JOBS[name](datetime.now(timezone.utc))
    except Exception as error:
        logger.exception("Ha fallado la tarea %s", name)
        try:
            send_telegram_message(redact(f'Ha fallado la tarea "{name}": {error}'))
        except Exception:
            logger.exception("No se pudo avisar por Telegram")
        raise
    level = logging.DEBUG if name in QUIET_JOBS else logging.INFO
    logger.log(level, "Tarea %s terminada en %.1f s: %s", name, time.perf_counter() - started, result)
    return result


def build_scheduler() -> BackgroundScheduler:
    # Los horarios van en hora de Madrid, así que el cambio de hora no los desfasa.
    scheduler = BackgroundScheduler(timezone=MADRID_TIMEZONE)
    scheduler.add_job(run_and_report, IntervalTrigger(minutes=1), args=["reminders"], id="reminders")
    scheduler.add_job(
        run_and_report,
        CronTrigger(hour=DAILY_IMPORT_HOUR, minute=0, timezone=MADRID_TIMEZONE),
        args=["import-expenses"],
        id="import-expenses",
    )
    scheduler.add_job(
        run_and_report,
        CronTrigger(day_of_week="sun", hour=WEEKLY_SUMMARY_HOUR, minute=0, timezone=MADRID_TIMEZONE),
        args=["weekly-summary"],
        id="weekly-summary",
    )
    logger.info(
        "Tareas programadas: recordatorios cada minuto, gastos a diario a las %d:00 y resumen los domingos a las %d:00",
        DAILY_IMPORT_HOUR,
        WEEKLY_SUMMARY_HOUR,
    )
    return scheduler
