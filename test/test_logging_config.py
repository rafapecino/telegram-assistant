"""Los logs y los avisos no deben llevar secretos."""

import logging
import sys

from api.logging_config import RedactingFormatter, redact


def test_oculta_los_valores_de_las_variables_secretas(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_secreto_de_prueba")
    assert redact("Groq rechazó la clave gsk_secreto_de_prueba") == "Groq rechazó la clave <GROQ_API_KEY oculto>"


def test_oculta_el_token_de_telegram_en_las_urls():
    text = redact("POST https://api.telegram.org/bot123456:AAH-abc_def/sendMessage")
    assert "AAH-abc_def" not in text


def test_oculta_la_contrasena_de_la_base_de_datos():
    text = redact("no se pudo conectar a postgresql://postgres.abc:MiClave123@host:5432/postgres")
    assert "MiClave123" not in text
    assert "postgres.abc" in text


def test_oculta_el_codigo_y_el_state_del_banco_pero_no_otras_palabras():
    text = redact("GET /bank/callback?state=abc123&code=xyz789 status_code=200")
    assert "abc123" not in text and "xyz789" not in text
    assert "status_code=200" in text


def test_oculta_secretos_tambien_en_las_trazas_de_excepciones(monkeypatch):
    monkeypatch.setenv("INTERNAL_SECRET", "secreto-interno-largo")
    try:
        raise RuntimeError("fallo con secreto-interno-largo")
    except RuntimeError:
        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "error", None, exc_info=True)
        record.exc_info = sys.exc_info()
    record.request_id = "-"
    assert "secreto-interno-largo" not in RedactingFormatter("%(message)s").format(record)
