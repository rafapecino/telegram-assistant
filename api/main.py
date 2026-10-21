"""Endpoints de FastAPI: webhook de Telegram, vuelta del banco, tareas y datos para el frontend."""

import hmac
import logging
import mimetypes
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from api.bank_connection import InvalidBankLinkError, claim_bank_link, complete_bank_link
from api.bot import build_reply
from api.config import env_flag, optional_env, public_url, require_env, warn_about_weak_secrets
from api.db import init_db
from api.enable_banking import BankSession
from api.expenses import (
    EXPENSE_CATEGORIES,
    IMPORT_WINDOW_DAYS,
    get_expense_summary,
    import_recent_expenses,
    update_expense_category,
)
from api.jobs import UnknownJobError, build_scheduler, run_and_report
from api.logging_config import redact, request_id_var, setup_logging
from api.madrid_time import format_madrid_datetime
from api.models import ExpenseCategoryUpdate, ExpenseSummary, JobResult, ReminderCreate, ReminderOut, TelegramUpdate
from api.reminders import complete_reminder, create_reminder, delete_reminder, list_pending_reminders
from api.telegram import is_authorized_user, send_telegram_message, set_telegram_webhook

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    warn_about_weak_secrets()
    init_db()
    # Con varios workers o réplicas, deja ENABLE_SCHEDULER=true solo en uno para no duplicar tareas.
    scheduler = build_scheduler() if env_flag("ENABLE_SCHEDULER", True) else None
    if scheduler:
        scheduler.start()
    logger.info(
        "API arrancada (tareas programadas: %s, panel web: %s, /docs: %s)",
        "sí" if scheduler else "no",
        "sí" if FRONTEND_DIST.is_dir() else "no",
        "sí" if DOCS_ENABLED else "no",
    )
    yield
    if scheduler:
        scheduler.shutdown(wait=False)
    logger.info("API detenida")


# La documentación interactiva describe todos los endpoints: en producción se deja apagada salvo que se pida.
DOCS_ENABLED = env_flag("ENABLE_DOCS", False)
app = FastAPI(
    title="Telegram assistant",
    lifespan=lifespan,
    docs_url="/docs" if DOCS_ENABLED else None,
    redoc_url="/redoc" if DOCS_ENABLED else None,
    openapi_url="/openapi.json" if DOCS_ENABLED else None,
)


# --- Middleware: trazas de cada petición y cabeceras de seguridad ---

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    # La vuelta del banco lleva el código de autorización en la URL: no se envía a otras webs.
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}
# El panel solo carga sus propios archivos. /docs carga Swagger desde un CDN, así que allí no se aplica.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)
DOCS_PATHS = ("/docs", "/redoc")


@app.middleware("http")
async def trace_and_secure(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    request_id_var.set(uuid.uuid4().hex[:8])
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Error no controlado en %s %s", request.method, request.url.path)
        response = JSONResponse({"detail": "Error interno"}, status_code=500)

    elapsed_ms = (time.perf_counter() - started) * 1000
    # Se registra la ruta sin la query: la del banco lleva el código de autorización.
    level = logging.WARNING if response.status_code >= 400 else logging.INFO
    logger.log(level, "%s %s -> %d (%.0f ms)", request.method, request.url.path, response.status_code, elapsed_ms)

    response.headers.update(SECURITY_HEADERS)
    if not request.url.path.startswith(DOCS_PATHS):
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    if not request.url.path.startswith("/assets/"):
        # Gastos y recordatorios no deben quedarse en la caché del navegador ni de proxies.
        response.headers["Cache-Control"] = "no-store"
    return response


# --- Autenticación ---


def _check_secret(request: Request, received: str | None, env_name: str) -> None:
    """Compara en tiempo constante. Sin el secreto configurado, el endpoint queda cerrado (nunca abierto)."""
    expected = optional_env(env_name)
    if not expected:
        logger.error("%s no está configurado: %s queda bloqueado", env_name, request.url.path)
        raise HTTPException(status_code=503, detail="Servicio no configurado")
    if not hmac.compare_digest((received or "").encode(), expected.encode()):
        client = request.client.host if request.client else "desconocido"
        logger.warning("Credencial incorrecta para %s desde %s", request.url.path, client)
        raise HTTPException(status_code=401, detail="No autorizado")


def require_internal_secret(request: Request, x_internal_secret: str | None = Header(default=None)) -> None:
    _check_secret(request, x_internal_secret, "INTERNAL_SECRET")


def require_panel_token(request: Request, authorization: str | None = Header(default=None)) -> None:
    scheme, _, token = (authorization or "").partition(" ")
    _check_secret(request, token if scheme.lower() == "bearer" else None, "PANEL_TOKEN")


def _notify(message: str) -> None:
    try:
        send_telegram_message(redact(message))
    except Exception:
        logger.exception("No se pudo avisar por Telegram")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Telegram ---


@app.post("/telegram/webhook", response_class=PlainTextResponse)
def telegram_webhook(
    update: TelegramUpdate,
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> str:
    _check_secret(request, x_telegram_bot_api_secret_token, "TELEGRAM_WEBHOOK_SECRET")

    message = update.message
    # Telegram reintenta si no recibe un 200, así que se responde 200 siempre y los errores se cuentan por el chat.
    if message is None or not message.text:
        logger.info("Actualización de Telegram sin texto: se ignora")
        return "ok"
    user_id = message.sender.id if message.sender else None
    if not is_authorized_user(user_id):
        # Queda en los logs para poder averiguar el ID de quien escribe sin depender de otros bots.
        logger.warning("Mensaje ignorado: el usuario de Telegram %s no es TELEGRAM_USER_ID", user_id)
        return "ok"

    text = message.text.strip()
    # Del mensaje solo se registra el comando o la longitud: el texto puede tener datos personales.
    logger.info("Mensaje recibido: %s", text.split()[0] if text.startswith("/") else f"texto libre ({len(text)} caracteres)")
    try:
        send_telegram_message(build_reply(text, datetime.now(timezone.utc)))
        logger.info("Respuesta enviada")
    except Exception as exc:
        logger.exception("No se pudo responder al mensaje")
        _notify(f"Algo ha fallado: {exc}")
    return "ok"


@app.post("/telegram/setup-webhook", dependencies=[Depends(require_internal_secret)])
def setup_telegram_webhook() -> dict[str, str]:
    set_telegram_webhook(public_url("/telegram/webhook"), require_env("TELEGRAM_WEBHOOK_SECRET"))
    logger.info("Webhook de Telegram configurado")
    return {"result": "Webhook de Telegram configurado"}


# --- Banco ---

# Lo que ve el navegador es genérico; el detalle llega por Telegram, que solo lee el dueño del bot.
BANK_DONE_PAGE = "Banco conectado. Te he enviado el resultado por Telegram.\n\nYa puedes cerrar esta pestaña."
BANK_FAILED_PAGE = "No se pudo conectar el banco. Te he enviado el detalle por Telegram."


def _import_after_connecting(session: BankSession, now: datetime) -> str:
    connected = (
        f"Banco conectado: {len(session.account_uids)} cuenta(s), "
        f"con acceso hasta el {format_madrid_datetime(session.valid_until)}."
    )
    try:
        imported_count = import_recent_expenses(now)
    except Exception as exc:
        logger.exception("Falló la primera importación de gastos")
        return f"{connected} Pero ha fallado la primera importación de gastos: {exc}"
    return f"{connected} He importado {imported_count} gastos de los últimos {IMPORT_WINDOW_DAYS} días."


@app.get("/bank/callback", response_class=PlainTextResponse)
def bank_callback(
    state: str | None = Query(default=None, max_length=100),
    code: str | None = Query(default=None, max_length=2000),
    error: str | None = Query(default=None, max_length=200),
    error_description: str | None = Query(default=None, max_length=500),
) -> PlainTextResponse:
    now = datetime.now(timezone.utc)
    if error:
        # Esta URL es pública: solo se avisa por Telegram si viene de un enlace nuestro y vigente, para que nadie
        # pueda usarla para mandarte mensajes con el texto que quiera.
        if state and claim_bank_link(state, now):
            logger.warning("El banco no autorizó el acceso")
            _notify(f"El banco no autorizó el acceso: {error_description or error}")
        return PlainTextResponse("El banco no autorizó el acceso.", status_code=400)
    if not state or not code:
        return PlainTextResponse("Faltan los parámetros state y code.", status_code=400)

    try:
        session = complete_bank_link(state, code, now)
    except InvalidBankLinkError as exc:
        return PlainTextResponse(str(exc), status_code=400)
    except Exception as exc:
        logger.exception("No se pudo conectar el banco")
        _notify(f"No se pudo conectar el banco: {exc}")
        return PlainTextResponse(BANK_FAILED_PAGE, status_code=500)
    _notify(_import_after_connecting(session, now))
    return PlainTextResponse(BANK_DONE_PAGE)


# --- Tareas ---


@app.post("/jobs/{name}", response_model=JobResult, dependencies=[Depends(require_internal_secret)])
def run_job_now(name: str):
    logger.info("Tarea %s lanzada a mano", name)
    try:
        result = run_and_report(name)
    except UnknownJobError:
        raise HTTPException(status_code=404, detail=f"Tarea desconocida: {name}")
    except Exception:
        # run_and_report ya lo ha registrado y avisado por Telegram.
        return JSONResponse({"job": name, "error": "La tarea ha fallado. El detalle está en los logs y en Telegram."}, status_code=500)
    return JobResult(job=name, result=result)


# --- Datos para el frontend (protegidos con PANEL_TOKEN) ---

panel = [Depends(require_panel_token)]


@app.get("/expenses/summary", response_model=ExpenseSummary, dependencies=panel)
def expenses_summary(days: int = Query(default=7, ge=1, le=90)) -> ExpenseSummary:
    return get_expense_summary(days, datetime.now(timezone.utc))


@app.patch("/expenses/{expense_id}", status_code=204, dependencies=panel)
def change_expense_category(expense_id: int, payload: ExpenseCategoryUpdate) -> Response:
    if payload.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Categoría desconocida: {payload.category}")
    if not update_expense_category(expense_id, payload.category):
        raise HTTPException(status_code=404, detail="El gasto no existe.")
    return Response(status_code=204)


@app.get("/reminders/pending", response_model=list[ReminderOut], dependencies=panel)
def pending_reminders() -> list[ReminderOut]:
    return list_pending_reminders()


@app.post("/reminders", response_model=ReminderOut, status_code=201, dependencies=panel)
def add_reminder(payload: ReminderCreate) -> ReminderOut:
    if payload.remind_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="La fecha del recordatorio ya ha pasado.")
    reminder_id = create_reminder(payload.text, payload.remind_at)
    return ReminderOut(id=reminder_id, text=payload.text, remind_at=payload.remind_at)


@app.post("/reminders/{reminder_id}/complete", status_code=204, dependencies=panel)
def mark_reminder_completed(reminder_id: int) -> Response:
    if not complete_reminder(reminder_id, datetime.now(timezone.utc)):
        raise HTTPException(status_code=404, detail="El recordatorio no existe o ya no está pendiente.")
    return Response(status_code=204)


@app.delete("/reminders/{reminder_id}", status_code=204, dependencies=panel)
def remove_reminder(reminder_id: int) -> Response:
    if not delete_reminder(reminder_id):
        raise HTTPException(status_code=404, detail="El recordatorio no existe.")
    return Response(status_code=204)


# --- Frontend ---

# Si existe la web de React compilada (npm run build), la API la sirve en "/". En desarrollo se usa
# npm run dev, que reenvía las llamadas aquí. Se monta al final para que las rutas de arriba tengan prioridad.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    # En Windows, el registro puede asociar .js a text/plain, y el navegador no cargaría los módulos.
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
