-- Executar como proprietário SOMENTE em um ambiente de teste após admin-panel.sql.
-- Não cria usuários e não modifica registros. ROLLBACK restaura as configurações.
begin;

do $$
begin
  if has_function_privilege('anon', 'public.admin_painel()', 'execute') then
    raise exception 'FALHA: anon pode executar admin_painel';
  end if;
  if has_function_privilege('authenticated', 'public.admin_painel()', 'execute') is not true then
    raise exception 'FALHA: authenticated não pode consultar a RPC';
  end if;
  if has_schema_privilege('authenticated', 'app_admin_private', 'usage') then
    raise exception 'FALHA: authenticated alcança o cadastro privado';
  end if;
  if has_table_privilege('authenticated', 'app_admin_private.members', 'insert') then
    raise exception 'FALHA: authenticated pode conceder privilégio administrativo';
  end if;
end;
$$;

-- Identidade sem vínculo, mesmo declarando metadados administrativos.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"admin":true}}', true);
set local role authenticated;
do $$
begin
  if public.is_app_admin() then raise exception 'FALHA: metadados concederam admin'; end if;
  begin
    perform public.admin_painel();
    raise exception 'FALHA: usuário comum consultou o painel';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.profiles where id <> auth.uid()) then
    raise exception 'FALHA: usuário comum lê perfis de terceiros';
  end if;
  if exists (select 1 from public.conversoes where user_id <> auth.uid()) then
    raise exception 'FALHA: usuário comum lê conversões de terceiros';
  end if;
end;
$$;
reset role;

-- A conta vinculada deve receber somente o contrato do painel.
select set_config('request.jwt.claim.sub', user_id::text, true)
  from app_admin_private.members m join auth.users u on u.id = m.user_id
  where lower(u.email) = 'caiolms98@yahoo.com.br';
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('request.jwt.claim.sub'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_data jsonb;
begin
  if not public.is_app_admin() then raise exception 'FALHA: conta vinculada sem autorização'; end if;
  v_data := public.admin_painel();
  if jsonb_typeof(v_data -> 'usuarios') <> 'array'
     or jsonb_typeof(v_data -> 'recentes') <> 'array'
     or jsonb_array_length(v_data -> 'usuarios') > 50
     or jsonb_array_length(v_data -> 'recentes') > 50 then
    raise exception 'FALHA: contrato do painel inválido';
  end if;
end;
$$;
reset role;
rollback;
