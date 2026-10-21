-- La columna ya no guarda el identificador del banco: guarda la clave que construye el bot
-- con los datos del gasto (ver assignTransactionKeys en expenses.ts).
alter table public.expenses rename column bank_transaction_id to transaction_key;
alter table public.expenses rename constraint expenses_bank_transaction_id_key to expenses_transaction_key_key;
