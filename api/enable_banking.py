"""Cliente de Enable Banking (open banking): autorización del banco y lectura de movimientos."""

import base64
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from api.config import require_env
from api.models import BankTransaction, BankTransactionPage

logger = logging.getLogger(__name__)

ENABLE_BANKING_API = "https://api.enablebanking.com"
# Banco del usuario. Enable Banking lo identifica por nombre y país.
BANK = {"name": "Banco Santander", "country": "ES"}


@dataclass(frozen=True)
class BankSession:
    session_id: str
    account_uids: list[str]
    valid_until: datetime


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _base64url_json(value: dict[str, Any]) -> str:
    return _base64url(json.dumps(value, separators=(",", ":")).encode())


def pem_to_der(pem: str) -> bytes:
    """Acepta el .pem con saltos de línea reales o escritos como "\\n", según cómo se haya pegado en el entorno."""
    if "BEGIN RSA PRIVATE KEY" in pem:
        raise ValueError("La clave privada está en formato PKCS#1; hace falta PKCS#8 (BEGIN PRIVATE KEY).")
    body = re.sub(r"-----(BEGIN|END) PRIVATE KEY-----", "", pem)
    return base64.b64decode(re.sub(r"\\n|\s", "", body))


def create_enable_banking_jwt(application_id: str, private_key_pem: str, now: datetime) -> str:
    """JWT firmado con la clave de la aplicación: Enable Banking lo exige en cada petición."""
    key = serialization.load_der_private_key(pem_to_der(private_key_pem), password=None)
    issued_at = int(now.timestamp())
    header = _base64url_json({"typ": "JWT", "alg": "RS256", "kid": application_id})
    payload = _base64url_json(
        {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": issued_at, "exp": issued_at + 3600}
    )
    signing_input = f"{header}.{payload}"
    signature = key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{signing_input}.{_base64url(signature)}"


def _parse_response_body(text: str) -> dict[str, Any]:
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except ValueError:
        return {"message": text}
    return parsed if isinstance(parsed, dict) else {"message": text}


def _request(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    jwt = create_enable_banking_jwt(
        require_env("ENABLE_BANKING_APP_ID"),
        require_env("ENABLE_BANKING_PRIVATE_KEY"),
        datetime.now(timezone.utc),
    )
    response = httpx.request(
        method,
        f"{ENABLE_BANKING_API}{path}",
        headers={"Authorization": f"Bearer {jwt}"},
        json=body,
        timeout=30,
    )
    # Sin la query ni el identificador de la cuenta, que es un dato del usuario.
    endpoint = re.sub(r"/accounts/[^/]+", "/accounts/*", path.split("?")[0])
    logger.info("Enable Banking %s %s -> %d", method, endpoint, response.status_code)
    result = _parse_response_body(response.text)
    if response.is_error:
        detail = f"{result['error']}: {result.get('message')}" if "error" in result else json.dumps(result)
        raise RuntimeError(f"Enable Banking respondió {response.status_code} en {endpoint} ({detail})")
    return result


def _maximum_consent_seconds() -> int:
    aspsps = _request("GET", f"/aspsps?country={BANK['country']}&psu_type=personal")["aspsps"]
    bank = next((aspsp for aspsp in aspsps if aspsp["name"] == BANK["name"]), None)
    if bank is None:
        raise RuntimeError(f'Enable Banking no tiene "{BANK["name"]}" en la lista de bancos de {BANK["country"]}.')
    return int(bank["maximum_consent_validity"])


def start_bank_authorization(state: str, redirect_url: str, now: datetime) -> str:
    """Devuelve el enlace en el que el usuario autoriza el acceso desde su banco."""
    # Se resta un minuto de margen: el banco rechaza fechas por encima de su máximo.
    validity = timedelta(seconds=_maximum_consent_seconds() - 60)
    valid_until = (now + validity).astimezone(timezone.utc).isoformat(timespec="milliseconds")
    result = _request(
        "POST",
        "/auth",
        {
            "access": {"valid_until": valid_until},
            "aspsp": BANK,
            "state": state,
            "redirect_url": redirect_url,
            "psu_type": "personal",
        },
    )
    return result["url"]


def create_bank_session(code: str) -> BankSession:
    session = _request("POST", "/sessions", {"code": code})
    account_uids = [account["uid"] for account in session["accounts"] if account.get("uid")]
    if not account_uids:
        raise RuntimeError("El banco no ha compartido ninguna cuenta.")
    return BankSession(
        session_id=session["session_id"],
        account_uids=account_uids,
        valid_until=datetime.fromisoformat(session["access"]["valid_until"]),
    )


def fetch_transactions(account_uid: str, date_from: str) -> list[BankTransaction]:
    transactions: list[BankTransaction] = []
    continuation_key: str | None = None
    while True:
        query = {"date_from": date_from}
        if continuation_key:
            query["continuation_key"] = continuation_key
        page = BankTransactionPage.model_validate(
            _request("GET", f"/accounts/{account_uid}/transactions?{urlencode(query)}")
        )
        transactions.extend(page.transactions)
        continuation_key = page.continuation_key
        if not continuation_key:
            return transactions
