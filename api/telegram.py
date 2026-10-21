"""Llamadas a la API de Telegram. El bot es personal: siempre escribe a un único usuario."""

import logging
from typing import Any

import httpx

from api.config import optional_env, require_env

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"


def _call_telegram(method: str, payload: dict[str, Any]) -> None:
    url = f"{TELEGRAM_API}/bot{require_env('TELEGRAM_BOT_TOKEN')}/{method}"
    # La URL lleva el token del bot: nunca se registra (por eso httpx está en WARNING).
    result = httpx.post(url, json=payload, timeout=30).json()
    if not result.get("ok"):
        raise RuntimeError(f"Telegram rechazó {method}: {result.get('description')}")
    logger.debug("Telegram %s correcto", method)


def send_telegram_message(text: str) -> None:
    # En un chat privado, chat_id es el id del usuario.
    _call_telegram("sendMessage", {"chat_id": require_env("TELEGRAM_USER_ID"), "text": text})


def set_telegram_webhook(url: str, secret_token: str) -> None:
    _call_telegram("setWebhook", {"url": url, "secret_token": secret_token, "allowed_updates": ["message"]})


def is_authorized_user(user_id: int | None) -> bool:
    """Sin TELEGRAM_USER_ID configurado nadie está autorizado, y el webhook deja el ID de quien escribe en los logs."""
    authorized_user_id = optional_env("TELEGRAM_USER_ID")
    return user_id is not None and authorized_user_id != "" and str(user_id) == authorized_user_id
