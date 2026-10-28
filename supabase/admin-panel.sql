-- Executar no SQL Editor, como proprietário do banco, após o SQL base do app.
-- A conta abaixo precisa existir e ter o e-mail confirmado.
-- Tudo é aplicado em uma transação; não altera registros ou limites existentes.
begin;

create schema if not exists app_admin_private;
revoke all on schema app_admin_private from public, anon, authenticated;

create table if not exists app_admin_private.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table app_admin_private.members enable row level security;
revoke all on table app_admin_private.members from public, anon, authenticated;

-- Vincular o acesso ao UUID existente, não a metadados editáveis ou só ao JWT.
do $$
declare
  v_uid uuid;
begin
  select id into strict v_uid from auth.users
  where lower(email) = 'caiolms98@yahoo.com.br'
    and email_confirmed_at is not null;
  insert into app_admin_private.members(user_id) values (v_uid)
    on conflict (user_id) do nothing;
exception
  when no_data_found then
    raise exception 'Crie e confirme a conta caiolms98@yahoo.com.br antes de executar este SQL.';
  when too_many_rows then
    raise exception 'Mais de uma conta corresponde ao e-mail de administrador. Revise Authentication > Users.';
end;
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_admin_private.members m
    join auth.users u on u.id = m.user_id
    where m.user_id = auth.uid()
      and lower(u.email) = 'caiolms98@yahoo.com.br'
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;
revoke all on function public.is_app_admin() from public, anon, authenticated;
grant execute on function public.is_app_admin() to authenticated;

-- Políticas aditivas, somente de leitura; as políticas próprias continuam.
alter table public.profiles enable row level security;
alter table public.conversoes enable row level security;
drop policy if exists "admin: ler perfis" on public.profiles;
create policy "admin: ler perfis" on public.profiles
  for select to authenticated using (public.is_app_admin());
drop policy if exists "admin: ler conversoes" on public.conversoes;
create policy "admin: ler conversoes" on public.conversoes
  for select to authenticated using (public.is_app_admin());
-- Configuração é consultada somente por RPC: não abrir acesso direto a outras chaves.

create or replace function public.admin_painel()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicio timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')
    at time zone 'America/Sao_Paulo');
  v_fim timestamptz := ((date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day')
    at time zone 'America/Sao_Paulo');
  v_limite integer;
  v_resultado jsonb;
begin
  -- SECURITY DEFINER exige autorização explícita antes de consultar dados globais.
  if not public.is_app_admin() then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  select greatest(coalesce(valor, 0), 0) into v_limite
    from public.app_config where chave = 'limite_conta';
  v_limite := coalesce(v_limite, 0);

  select jsonb_build_object(
    'atualizado_em', now(),
    'usuarios_total', (select count(*) from auth.users where deleted_at is null),
    'conversoes_total', (select count(*) from public.conversoes),
    'conversoes_hoje', (select count(*) from public.conversoes
      where criado_em >= v_inicio and criado_em < v_fim),
    'limite_padrao', v_limite,
    'usuarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', left(coalesce(nullif(p.nome, ''), 'Sem nome'), 200),
        'email', u.email,
        'criado_em', u.created_at,
        'conversoes_hoje', (select count(*) from public.conversoes c
          where c.user_id = u.id and c.criado_em >= v_inicio and c.criado_em < v_fim),
        'limite_diario', v_limite
      ) order by u.created_at desc, u.id)
      from (select id, email, created_at from auth.users
        where deleted_at is null order by created_at desc, id limit 50) u
      left join public.profiles p on p.id = u.id
    ), '[]'::jsonb),
    'recentes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', u.email, 'ferramenta', c.ferramenta, 'criado_em', c.criado_em
      ) order by c.criado_em desc, c.id desc)
      from (select id, user_id, ferramenta, criado_em from public.conversoes
        order by criado_em desc, id desc limit 50) c
      left join auth.users u on u.id = c.user_id
    ), '[]'::jsonb)
  ) into v_resultado;
  return v_resultado;
end;
$$;
revoke all on function public.admin_painel() from public, anon, authenticated;
grant execute on function public.admin_painel() to authenticated;

-- O índice existente começa por user_id; este atende ao período global/últimas conversões.
create index if not exists conversoes_admin_data
  on public.conversoes (criado_em desc, id desc);

commit;
