"""Configuración leída de variables de entorno (o del archivo .env)."""

import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Cadenas aleatorias que protegen la API. Con menos de 32 caracteres se pueden adivinar por fuerza bruta.
RANDOM_SECRETS = ("TELEGRAM_WEBHOOK_SECRET", "INTERNAL_SECRET", "PANEL_TOKEN")
MIN_SECRET_LENGTH = 32


def require_env(name: str) -> str:
    """Lee una variable obligatoria y, si falta, explica dónde añadirla."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Falta la variable de entorno {name}. Añádela al archivo .env o al entorno del servidor.")
    return value


def optional_env(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def env_flag(name: str, default: bool) -> bool:
    return optional_env(name, "true" if default else "false").lower() == "true"


def public_url(path: str) -> str:
    """URL pública de la API: Telegram y el banco la usan para llamarnos de vuelta."""
    return f"{require_env('PUBLIC_BASE_URL').rstrip('/')}{path}"


def warn_about_weak_secrets() -> None:
    """Avisa al arrancar de secretos ausentes o cortos. Solo se registra el nombre, nunca el valor."""
    for name in RANDOM_SECRETS:
        value = optional_env(name)
        if not value:
            logger.warning("Falta %s: los endpoints que protege responderán 503 hasta que se configure", name)
        elif len(value) < MIN_SECRET_LENGTH:
            logger.warning("%s tiene menos de %d caracteres: genera uno más largo", name, MIN_SECRET_LENGTH)
