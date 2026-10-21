"""Cliente de Groq para pedir respuestas en JSON al modelo."""

import json
import logging
import time
from typing import Any

import httpx

from api.config import require_env

logger = logging.getLogger(__name__)

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
# Modelo open source. Groq usa el formato de la API de OpenAI: cambiar de proveedor es cambiar URL y modelo.
GROQ_MODEL = "openai/gpt-oss-120b"


def ask_groq_for_json(system_prompt: str, user_message: str) -> Any:
    """Pide al modelo una respuesta en JSON y la devuelve ya parseada (sin validar: eso lo hace quien llama)."""
    started = time.perf_counter()
    response = httpx.post(
        GROQ_CHAT_URL,
        headers={"Authorization": f"Bearer {require_env('GROQ_API_KEY')}"},
        json={
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
        },
        timeout=60,
    )
    logger.info("Groq respondió %d en %.1f s", response.status_code, time.perf_counter() - started)
    if response.is_error:
        raise RuntimeError(f"Groq respondió {response.status_code}: {response.text}")
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        content = None
    try:
        return json.loads(content)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"Groq no devolvió un JSON válido: {content}") from error
