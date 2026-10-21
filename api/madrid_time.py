"""Hora de Madrid: conversión entre hora local y UTC, y fechas en español."""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

MADRID = ZoneInfo("Europe/Madrid")
LOCAL_DATE_TIME_PATTERN = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$")
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


@dataclass(frozen=True)
class MadridClock:
    local_date_time: str
    local_date: str
    weekday: str
    hour: int
    is_sunday: bool


def madrid_local_to_utc(local_date_time: str) -> datetime:
    """Convierte una hora local de Madrid ("2026-10-26T17:00") en un instante UTC, respetando el cambio de hora."""
    match = LOCAL_DATE_TIME_PATTERN.match(local_date_time)
    if not match:
        raise ValueError(f"Fecha local con formato no válido: {local_date_time}")
    year, month, day, hour, minute = (int(part) for part in match.groups())
    try:
        local = datetime(year, month, day, hour, minute, tzinfo=MADRID)
    except ValueError as error:
        raise ValueError(f"Fecha local inexistente: {local_date_time}") from error
    return local.astimezone(timezone.utc)


def madrid_clock(instant: datetime) -> MadridClock:
    local = instant.astimezone(MADRID)
    return MadridClock(
        local_date_time=local.strftime("%Y-%m-%dT%H:%M"),
        local_date=local.strftime("%Y-%m-%d"),
        weekday=WEEKDAYS[local.weekday()],
        hour=local.hour,
        is_sunday=local.weekday() == 6,
    )


def format_madrid_datetime(instant: datetime) -> str:
    """Fecha legible en español, por ejemplo "jueves, 23 de octubre, 17:00"."""
    local = instant.astimezone(MADRID)
    return f"{WEEKDAYS[local.weekday()]}, {local.day} de {MONTHS[local.month - 1]}, {local:%H:%M}"


def madrid_date_days_ago(now: datetime, days: int) -> str:
    """Fecha local de Madrid (YYYY-MM-DD) de hace `days` días."""
    return (now - timedelta(days=days)).astimezone(MADRID).strftime("%Y-%m-%d")
