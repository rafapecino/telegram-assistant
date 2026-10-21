from datetime import datetime, timezone

import pytest

from api.reminders import parse_reminder_answer

NOW = datetime(2026, 10, 21, 10, 0, tzinfo=timezone.utc)


def test_acepta_un_recordatorio_valido_y_convierte_la_hora_de_madrid():
    result = parse_reminder_answer(
        {"is_reminder": True, "text": " llamar a Juan ", "local_datetime": "2026-10-22T17:00"}, NOW
    )
    assert result.kind == "reminder"
    assert result.text == "llamar a Juan"
    assert result.remind_at == datetime(2026, 10, 22, 15, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("raw", [{"is_reminder": False}, None, {"is_reminder": "true"}])
def test_un_mensaje_que_no_es_un_recordatorio_se_marca_como_tal(raw):
    assert parse_reminder_answer(raw, NOW).kind == "not_reminder"


@pytest.mark.parametrize(
    "raw",
    [
        {"is_reminder": True, "text": "x", "local_datetime": "2026-10-20T10:00"},
        {"is_reminder": True, "text": "x", "local_datetime": "el jueves"},
        {"is_reminder": True, "text": "  ", "local_datetime": "2026-10-22T17:00"},
        {"is_reminder": True, "text": "x"},
    ],
)
def test_rechaza_fechas_pasadas_mal_formadas_o_textos_vacios(raw):
    assert parse_reminder_answer(raw, NOW).kind == "invalid"
