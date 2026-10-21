import base64
import json
from datetime import datetime, timezone

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from api.enable_banking import create_enable_banking_jwt, pem_to_der


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def pem(private_key) -> str:
    return private_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()


def base64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def test_el_jwt_lleva_lo_que_pide_enable_banking_y_su_firma_es_valida(private_key, pem):
    jwt = create_enable_banking_jwt("app-id", pem, datetime(2026, 10, 21, 10, 0, tzinfo=timezone.utc))
    header, payload, signature = jwt.split(".")

    assert json.loads(base64url_decode(header)) == {"typ": "JWT", "alg": "RS256", "kid": "app-id"}
    assert json.loads(base64url_decode(payload)) == {
        "iss": "enablebanking.com",
        "aud": "api.enablebanking.com",
        "iat": 1792576800,
        "exp": 1792580400,
    }
    # verify lanza una excepción si la firma no es válida.
    private_key.public_key().verify(
        base64url_decode(signature), f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256()
    )


def test_acepta_el_pem_con_saltos_de_linea_escritos_como_barra_n(pem):
    assert pem_to_der(pem.replace("\n", "\\n")) == pem_to_der(pem)


def test_rechaza_claves_pkcs1_con_un_mensaje_claro():
    with pytest.raises(ValueError, match="PKCS#8"):
        pem_to_der("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")
