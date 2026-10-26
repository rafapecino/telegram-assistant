-- Datos que el asistente propone apuntar en la memoria. Esperan a que se pulse «Guárdalo» o «No».
create table public.memory_suggestions (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 1 and 300),
  -- La respuesta que acompañaba a la propuesta: al pulsar el botón, Telegram sustituye el mensaje entero
  -- y sin ella se perdería.
  answer text not null,
  created_at timestamptz not null default now()
);

-- Conversación del chat del panel, para que no se pierda al recargar.
create table public.chat_messages (
  id bigint generated always as identity primary key,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (char_length(text) > 0),
  created_at timestamptz not null default now()
);

alter table public.memory_suggestions enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.memory_suggestions from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
