-- Botones de cada mensaje del chat del panel, para que sigan ahí al recargar y para saber qué preguntas de sí o no
-- quedan por contestar.
alter table public.chat_messages add column buttons jsonb;
-- Las preguntas de hábitos se mandan también por Telegram: con el id de ese mensaje, contestar en un sitio
-- actualiza el otro.
alter table public.chat_messages add column telegram_message_id bigint;
