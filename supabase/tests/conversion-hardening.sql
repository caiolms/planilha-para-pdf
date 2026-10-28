-- Rodar como proprietário em ambiente de teste, após conversion-hardening.sql.
-- Todos os registros criados aqui são desfeitos pelo ROLLBACK.
begin;
do $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email_confirmed_at is not null
    and deleted_at is null limit 1;
  if v_uid is null then raise exception 'Crie uma conta confirmada no ambiente de teste.'; end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into public.conversoes(user_id, ferramenta, criado_em)
    select v_uid, 'planilha-pdf', clock_timestamp() from generate_series(1, 20);
  if has_function_privilege('anon', 'public.registrar_conversao(text)', 'execute') then
    raise exception 'FALHA: execução anônima permitida';
  end if;
end;
$$;
set local role authenticated;
do $$
declare v_antes bigint; v_depois bigint; v_tool text;
begin
  select count(*) into v_antes from public.conversoes where user_id = auth.uid();
  foreach v_tool in array array[null::text, '', 'inexistente', repeat('x', 1000)] loop
    begin
      perform public.registrar_conversao(v_tool);
      raise exception 'FALHA: ferramenta inválida foi aceita';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.registrar_conversao('planilha-pdf');
    raise exception 'FALHA: frequência excessiva foi aceita';
  exception when raise_exception then
    if sqlerrm <> 'limite_frequencia' then raise; end if;
  end;
  select count(*) into v_depois from public.conversoes where user_id = auth.uid();
  if v_depois <> v_antes then raise exception 'FALHA: requisição rejeitada gravou uma conversão'; end if;
end;
$$;
reset role;
rollback;
