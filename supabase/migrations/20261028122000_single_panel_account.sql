-- El panel solo está preparado para un espacio personal compartido por sus servicios internos.
-- No permitas autorizar una segunda cuenta hasta implementar separación de datos por usuario.
do $$
begin
  if (select count(*) from public.panel_users) > 1 then
    raise exception 'panel_users contains multiple accounts; separate personal data before enabling the single-account constraint';
  end if;
end;
$$;

create unique index panel_users_single_account_idx on public.panel_users ((true));
