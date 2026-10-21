"""Pruebas de los endpoints sin base de datos ni servicios externos (el lifespan no se ejecuta)."""

import pytest
from fastapi.testclient import TestClient

from api import main
from api.expense_questions import HELP_TEXT, QuestionInterpretation

SECRET_HEADER = {"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"}


@pytest.fixture
def sent_messages(monkeypatch) -> list[str]:
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "webhook-secret")
    monkeypatch.setenv("TELEGRAM_USER_ID", "1")
    messages: list[str] = []
    monkeypatch.setattr(main, "send_telegram_message", messages.append)
    monkeypatch.setattr(main, "build_reply", lambda text, now: f"respuesta a {text}")
    return messages


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def message_from(user_id: int, text: str = "hola") -> dict:
    return {"update_id": 1, "message": {"text": text, "from": {"id": user_id}}}


def test_el_webhook_rechaza_llamadas_sin_el_secreto_de_telegram(client, sent_messages):
    response = client.post("/telegram/webhook", json=message_from(1))
    assert response.status_code == 401
    assert sent_messages == []


def test_el_webhook_ignora_a_otros_usuarios(client, sent_messages):
    response = client.post("/telegram/webhook", json=message_from(2), headers=SECRET_HEADER)
    assert response.status_code == 200
    assert sent_messages == []


def test_el_webhook_responde_al_usuario_autorizado(client, sent_messages):
    response = client.post("/telegram/webhook", json=message_from(1, " hola "), headers=SECRET_HEADER)
    assert response.status_code == 200
    assert sent_messages == ["respuesta a hola"]


def test_health_responde_sin_base_de_datos(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_las_tareas_exigen_el_secreto_interno(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_SECRET", "internal")
    assert client.post("/jobs/reminders").status_code == 401
    assert client.post("/jobs/no-existe", headers={"X-Internal-Secret": "internal"}).status_code == 404


def test_las_tareas_no_devuelven_el_detalle_del_error(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_SECRET", "internal")

    def failing_job(name):
        raise RuntimeError("detalle interno con la contraseña")

    monkeypatch.setattr(main, "run_and_report", failing_job)
    response = client.post("/jobs/reminders", headers={"X-Internal-Secret": "internal"})
    assert response.status_code == 500
    assert "contraseña" not in response.text


# --- Panel web ---


@pytest.fixture
def panel_token(monkeypatch) -> dict:
    monkeypatch.setenv("PANEL_TOKEN", "panel-token")
    monkeypatch.setattr(main, "list_pending_reminders", lambda: [])
    return {"Authorization": "Bearer panel-token"}


def test_el_panel_exige_el_token(client, panel_token):
    assert client.get("/reminders/pending").status_code == 401
    assert client.get("/reminders/pending", headers={"Authorization": "Bearer otro"}).status_code == 401
    assert client.get("/reminders/pending", headers={"Authorization": "panel-token"}).status_code == 401
    assert client.get("/reminders/pending", headers=panel_token).json() == []


def test_sin_panel_token_configurado_el_panel_queda_cerrado(client, monkeypatch):
    monkeypatch.delenv("PANEL_TOKEN", raising=False)
    response = client.get("/reminders/pending", headers={"Authorization": "Bearer "})
    assert response.status_code == 503


def test_las_respuestas_llevan_cabeceras_de_seguridad(client, panel_token):
    response = client.get("/reminders/pending", headers=panel_token)
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]


def test_cambiar_la_categoria_de_un_gasto(client, panel_token, monkeypatch):
    updates: list[tuple[int, str]] = []
    monkeypatch.setattr(main, "update_expense_category", lambda expense_id, category: updates.append((expense_id, category)) or expense_id == 1)
    assert client.patch("/expenses/1", json={"category": "Ocio"}, headers=panel_token).status_code == 204
    assert client.patch("/expenses/2", json={"category": "Ocio"}, headers=panel_token).status_code == 404
    assert client.patch("/expenses/1", json={"category": "Viajes"}, headers=panel_token).status_code == 422
    assert client.patch("/expenses/1", json={"category": "Ocio"}).status_code == 401
    assert updates == [(1, "Ocio"), (2, "Ocio")]


def test_completar_y_borrar_recordatorios(client, panel_token, monkeypatch):
    monkeypatch.setattr(main, "complete_reminder", lambda reminder_id, now: reminder_id == 1)
    monkeypatch.setattr(main, "delete_reminder", lambda reminder_id: reminder_id == 1)
    assert client.post("/reminders/1/complete", headers=panel_token).status_code == 204
    assert client.post("/reminders/2/complete", headers=panel_token).status_code == 404
    assert client.delete("/reminders/1", headers=panel_token).status_code == 204
    assert client.delete("/reminders/2", headers=panel_token).status_code == 404
    assert client.delete("/reminders/1").status_code == 401


def test_preguntar_por_los_gastos(client, panel_token, monkeypatch):
    received: list[tuple[str, list[str]]] = []

    def interpret(question, previous_questions, now):
        received.append((question, previous_questions))
        return QuestionInterpretation(kind="unknown")

    monkeypatch.setattr(main, "interpret_expense_question", interpret)
    body = {"question": " ¿Y ayer? ", "previous_questions": ["¿Cuánto este mes?"]}
    response = client.post("/expenses/ask", json=body, headers=panel_token)
    assert response.status_code == 200
    assert response.json() == {"text": HELP_TEXT, "result": None}
    assert received == [("¿Y ayer?", ["¿Cuánto este mes?"])]
    assert client.post("/expenses/ask", json=body).status_code == 401


@pytest.mark.parametrize(
    "body",
    [{"question": "   "}, {"question": "x" * 301}, {"question": "hola", "previous_questions": ["a"] * 5}],
)
def test_una_pregunta_vacia_o_demasiado_larga_se_rechaza(client, panel_token, body):
    assert client.post("/expenses/ask", json=body, headers=panel_token).status_code == 422


def test_si_falla_la_ia_el_chat_recibe_un_aviso_sin_detalles(client, panel_token, monkeypatch):
    def failing(question, previous_questions, now):
        raise RuntimeError("Groq respondió 500 con la clave gsk_secreta")

    monkeypatch.setattr(main, "interpret_expense_question", failing)
    response = client.post("/expenses/ask", json={"question": "¿Cuánto este mes?"}, headers=panel_token)
    assert response.status_code == 502
    assert "gsk_" not in response.text
    assert "Inténtalo de nuevo" in response.json()["detail"]


def test_la_documentacion_esta_apagada_por_defecto(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


# --- Vuelta del banco ---


def test_un_error_del_banco_con_state_inventado_no_envia_mensajes(client, sent_messages, monkeypatch):
    monkeypatch.setattr(main, "claim_bank_link", lambda state, now: False)
    response = client.get("/bank/callback", params={"state": "falso", "error": "x", "error_description": "phishing"})
    assert response.status_code == 400
    assert "phishing" not in response.text
    assert sent_messages == []


def test_si_falla_la_conexion_el_navegador_no_ve_el_detalle(client, sent_messages, monkeypatch):
    def failing_link(state, code, now):
        raise RuntimeError("Enable Banking respondió 500 con datos internos")

    monkeypatch.setattr(main, "complete_bank_link", failing_link)
    response = client.get("/bank/callback", params={"state": "s", "code": "c"})
    assert response.status_code == 500
    assert "Enable Banking" not in response.text
    assert sent_messages == ["No se pudo conectar el banco: Enable Banking respondió 500 con datos internos"]
