-- Aplicar no SQL Editor após o SQL base do aplicativo.
-- Não altera limites diários nem remove histórico. Reaplicável.
begin;
create or replace function public.registrar_conversao(p_ferramenta text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status json;
  v_recentes integer;
  v_agora timestamptz;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  if p_ferramenta is null or not (p_ferramenta = any(array[
    'fotos-pdf', 'pdf-imagem', 'juntar-pdf', 'dividir-pdf', 'converter-fotos', 'planilha-pdf'
  ])) then
    raise exception 'ferramenta_invalida' using errcode = '22023';
  end if;

  -- A mesma trava do SQL original serializa verificação e inserção por usuário.
  perform pg_advisory_xact_lock(hashtext(v_uid::text));
  v_agora := clock_timestamp();
  select count(*) into v_recentes from (
    select 1 from public.conversoes
    where user_id = v_uid and criado_em >= v_agora - interval '60 seconds'
    limit 20
  ) recentes;
  if v_recentes >= 20 then
    raise exception 'limite_frequencia' using errcode = 'P0001';
  end if;

  v_status := public.status_conversoes();
  if not (v_status ->> 'ilimitado')::boolean
     and (v_status ->> 'restantes')::integer <= 0 then
    return (v_status::jsonb || jsonb_build_object('ok', false))::json;
  end if;
  insert into public.conversoes(user_id, ferramenta) values (v_uid, p_ferramenta);
  v_status := public.status_conversoes();
  return (v_status::jsonb || jsonb_build_object('ok', true))::json;
end;
$$;
revoke all on function public.registrar_conversao(text) from public, anon, authenticated;
grant execute on function public.registrar_conversao(text) to authenticated;
commit;
