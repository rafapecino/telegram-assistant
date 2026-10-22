"""Conexión con Postgres y creación de las tablas."""

import logging
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from api.config import require_env

logger = logging.getLogger(__name__)

SCHEMA = """
create table if not exists reminders (
  id bigint generated always as identity primary key,
  text text not null,
  remind_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_pending_idx on reminders (remind_at) where sent_at is null;
-- Completado a mano desde el panel: ya no se envía ni aparece como pendiente.
alter table reminders add column if not exists completed_at timestamptz;

-- Cada enlace de autorización bancaria lleva un "state" de un solo uso.
create table if not exists bank_authorizations (
  state text primary key default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists bank_sessions (
  session_id text primary key,
  account_uids text[] not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id bigint generated always as identity primary key,
  bank_transaction_id text not null unique,
  account_uid text not null,
  booking_date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  description text not null,
  category text not null,
  created_at timestamptz not null default now()
);
create index if not exists expenses_booking_date_idx on expenses (booking_date);

-- Ingresos para el balance. Los importa el bot de Supabase (misma tabla que su migración); el panel solo los lee.
create table if not exists incomes (
  id bigint generated always as identity primary key,
  transaction_key text not null unique,
  account_uid text not null,
  booking_date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  description text not null,
  created_at timestamptz not null default now()
);
create index if not exists incomes_booking_date_idx on incomes (booking_date);

-- Seguridad: en Supabase, las tablas de "public" se pueden leer por internet con la clave pública del proyecto.
-- RLS activado y sin políticas cierra ese acceso; la API conecta como propietaria de las tablas y no se ve afectada.
alter table reminders enable row level security;
alter table bank_authorizations enable row level security;
alter table bank_sessions enable row level security;
alter table expenses enable row level security;
alter table incomes enable row level security;

-- Y además se quitan los permisos a los roles públicos de Supabase (en otro Postgres no existen y se salta).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on reminders, bank_authorizations, bank_sessions, expenses, incomes from anon, authenticated;
  end if;
end
$$;
"""


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Abre una conexión que confirma la transacción al salir del bloque (o la deshace si hay error)."""
    # prepare_threshold=None: el pooler de Supabase en modo transacción no admite sentencias preparadas.
    with psycopg.connect(require_env("DATABASE_URL"), row_factory=dict_row, prepare_threshold=None) as connection:
        yield connection


def init_db() -> None:
    with connect() as connection:
        connection.execute(SCHEMA)
    logger.info("Base de datos lista: tablas comprobadas y acceso público cerrado (RLS)")
