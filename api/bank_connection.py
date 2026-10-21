"""Conexión con el banco: enlace de autorización de un solo uso y sesión activa."""

import logging
from datetime import datetime, timedelta

from api.config import public_url
from api.db import connect
from api.enable_banking import BankSession, create_bank_session, start_bank_authorization

logger = logging.getLogger(__name__)

AUTHORIZATION_LINK_LIFETIME = timedelta(minutes=30)


class InvalidBankLinkError(ValueError):
    """El state no existe, ya se usó o ha caducado. El mensaje se puede mostrar tal cual."""


def create_bank_link(now: datetime) -> str:
    with connect() as connection:
        state = connection.execute("insert into bank_authorizations default values returning state").fetchone()["state"]
    link = start_bank_authorization(state, public_url("/bank/callback"), now)
    logger.info("Enlace de autorización del banco creado (caduca en %d minutos)", AUTHORIZATION_LINK_LIFETIME.seconds // 60)
    return link


def claim_bank_link(state: str, now: datetime) -> bool:
    """Consume el state una sola vez. Devuelve False si no es válido, para que un enlace viejo o inventado no sirva."""
    with connect() as connection:
        claimed = connection.execute(
            "update bank_authorizations set used_at = %s"
            " where state = %s and used_at is null and created_at >= %s returning state",
            (now, state, now - AUTHORIZATION_LINK_LIFETIME),
        ).fetchall()
    if not claimed:
        # Puede ser un enlace caducado o alguien probando states: queda registrado, sin el valor.
        logger.warning("Vuelta del banco con un state no válido, usado o caducado")
    return bool(claimed)


def complete_bank_link(state: str, code: str, now: datetime) -> BankSession:
    """Canjea el código que devuelve el banco."""
    if not claim_bank_link(state, now):
        raise InvalidBankLinkError("El enlace no es válido o ha caducado. Pide otro con /conectar_banco.")

    session = create_bank_session(code)
    with connect() as connection:
        connection.execute(
            "insert into bank_sessions (session_id, account_uids, valid_until) values (%s, %s, %s)",
            (session.session_id, session.account_uids, session.valid_until),
        )
    logger.info("Sesión del banco guardada: %d cuenta(s), válida hasta %s", len(session.account_uids), session.valid_until)
    return session


def get_active_bank_session(now: datetime) -> BankSession | None:
    with connect() as connection:
        row = connection.execute(
            "select session_id, account_uids, valid_until from bank_sessions"
            " where valid_until > %s order by created_at desc limit 1",
            (now,),
        ).fetchone()
    return BankSession(**row) if row else None
