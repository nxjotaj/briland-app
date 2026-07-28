alter table public."AppTelemetryEvent"
  add column if not exists "sessionId" text null,
  add column if not exists "visitorId" text null,
  add column if not exists city text null,
  add column if not exists state text null,
  add column if not exists country text null;

create index if not exists "AppTelemetryEvent_city_createdAt_idx"
on public."AppTelemetryEvent" using btree (city, state, "createdAt");

create index if not exists "AppTelemetryEvent_sessionId_idx"
on public."AppTelemetryEvent" using btree ("sessionId");

create index if not exists "AppTelemetryEvent_createdAt_idx"
on public."AppTelemetryEvent" using btree ("createdAt");

alter table public."AppTelemetryEvent"
  drop constraint if exists "AppTelemetryEvent_payload_limits";

alter table public."AppTelemetryEvent"
  add constraint "AppTelemetryEvent_payload_limits" check (
    length("eventType") between 1 and 80
    and coalesce(length(screen), 0) <= 120
    and coalesce(length(route), 0) <= 120
    and coalesce(length("userId"), 0) <= 128
    and coalesce(length("userRole"), 0) <= 40
    and coalesce(length("sessionId"), 0) <= 128
    and coalesce(length("visitorId"), 0) <= 128
    and coalesce(length(city), 0) <= 120
    and coalesce(length(state), 0) <= 80
    and coalesce(length(country), 0) <= 80
    and coalesce(length(message), 0) <= 1000
    and coalesce(octet_length(metadata::text), 0) <= 16384
    and ("durationMs" is null or "durationMs" between 0 and 86400000)
  );

create table if not exists public."AppPresenceSession" (
  "sessionId" text primary key,
  "visitorId" text not null,
  "userId" text null references public."User"(id) on delete set null,
  "userName" text null,
  "userRole" text not null default 'VISITANTE',
  route text null,
  screen text null,
  source text not null,
  "deviceType" text null,
  "operatingSystem" text null,
  "networkType" text null,
  city text null,
  state text null,
  country text null,
  "startedAt" timestamptz not null default now(),
  "lastSeenAt" timestamptz not null default now(),
  "endedAt" timestamptz null,
  constraint "AppPresenceSession_payload_limits" check (
    length("sessionId") between 8 and 128
    and length("visitorId") between 8 and 128
    and coalesce(length("userName"), 0) <= 160
    and length("userRole") <= 40
    and coalesce(length(route), 0) <= 120
    and coalesce(length(screen), 0) <= 120
    and length(source) <= 40
    and coalesce(length("deviceType"), 0) <= 80
    and coalesce(length("operatingSystem"), 0) <= 80
    and coalesce(length("networkType"), 0) <= 40
    and coalesce(length(city), 0) <= 120
    and coalesce(length(state), 0) <= 80
    and coalesce(length(country), 0) <= 80
  )
);

create index if not exists "AppPresenceSession_lastSeenAt_idx"
on public."AppPresenceSession" using btree ("lastSeenAt" desc);

create index if not exists "AppPresenceSession_city_startedAt_idx"
on public."AppPresenceSession" using btree (city, state, "startedAt");

create index if not exists "AppPresenceSession_userId_lastSeenAt_idx"
on public."AppPresenceSession" using btree ("userId", "lastSeenAt" desc);

alter table public."AppPresenceSession" enable row level security;

drop policy if exists "presence master reads logged users" on public."AppPresenceSession";
create policy "presence master reads logged users"
on public."AppPresenceSession"
for select to authenticated
using (public.is_admin_master() and "userId" is not null);

revoke all on table public."AppPresenceSession" from anon, authenticated;
grant select on table public."AppPresenceSession" to authenticated;

create or replace function public.heartbeat_app_presence(
  p_session_id text,
  p_visitor_id text,
  p_route text default null,
  p_screen text default null,
  p_source text default 'APP',
  p_device_type text default null,
  p_operating_system text default null,
  p_network_type text default null,
  p_city text default null,
  p_state text default null,
  p_country text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public."User"%rowtype;
  v_is_new boolean;
begin
  if length(coalesce(p_session_id, '')) not between 8 and 128
     or length(coalesce(p_visitor_id, '')) not between 8 and 128 then
    raise exception 'Identificador da sessão inválido.';
  end if;

  select * into v_user
  from public."User"
  where "authUserId" = auth.uid()
    and status = 'ACTIVE'
  limit 1;

  select not exists (
    select 1 from public."AppPresenceSession" where "sessionId" = p_session_id
  ) into v_is_new;

  insert into public."AppPresenceSession" (
    "sessionId", "visitorId", "userId", "userName", "userRole", route, screen,
    source, "deviceType", "operatingSystem", "networkType", city, state, country,
    "startedAt", "lastSeenAt", "endedAt"
  )
  values (
    left(p_session_id, 128),
    left(p_visitor_id, 128),
    v_user.id,
    case when v_user.id is null then null else left(v_user.name, 160) end,
    coalesce(v_user.role::text, 'VISITANTE'),
    left(p_route, 120),
    left(p_screen, 120),
    left(coalesce(p_source, 'APP'), 40),
    left(p_device_type, 80),
    left(p_operating_system, 80),
    left(p_network_type, 40),
    left(p_city, 120),
    left(p_state, 80),
    left(p_country, 80),
    now(),
    now(),
    null
  )
  on conflict ("sessionId") do update set
    "userId" = excluded."userId",
    "userName" = excluded."userName",
    "userRole" = excluded."userRole",
    route = excluded.route,
    screen = excluded.screen,
    source = excluded.source,
    "deviceType" = excluded."deviceType",
    "operatingSystem" = excluded."operatingSystem",
    "networkType" = excluded."networkType",
    city = coalesce(excluded.city, "AppPresenceSession".city),
    state = coalesce(excluded.state, "AppPresenceSession".state),
    country = coalesce(excluded.country, "AppPresenceSession".country),
    "lastSeenAt" = now(),
    "endedAt" = null;

  if v_is_new and v_user.id is not null then
    update public."User"
    set "lastLoginAt" = now(), "updatedAt" = now()
    where id = v_user.id;
  end if;

  -- Limpeza oportunista garante a retenção mesmo quando pg_cron não está instalado.
  if random() < 0.01 then
    delete from public."AppPresenceSession" where "lastSeenAt" < now() - interval '30 days';
    delete from public."AppTelemetryEvent" where "createdAt" < now() - interval '30 days';
  end if;
end;
$$;

create or replace function public.end_app_presence(p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public."AppPresenceSession"
  set "endedAt" = now(), "lastSeenAt" = now()
  where "sessionId" = p_session_id
    and (
      "userId" is null
      or "userId" = (select id from public."User" where "authUserId" = auth.uid() limit 1)
    );
end;
$$;

create or replace function public._presence_commercial_summary_payload()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with authorized as (
    select public.is_admin_master() as allowed
  ),
  recent as (
    select *
    from public."AppPresenceSession", authorized
    where allowed
      and "startedAt" >= now() - interval '30 days'
  ),
  online as (
    select *
    from recent
    where "endedAt" is null and "lastSeenAt" >= now() - interval '2 minutes'
  ),
  city_rows as (
    select
      coalesce(nullif(city, ''), 'Não informado') as city,
      coalesce(nullif(state, ''), '-') as state,
      count(*)::int as sessions,
      count(distinct "visitorId")::int as visitors,
      count(*) filter (where "userId" is not null)::int as authenticated,
      max("lastSeenAt") as "lastAccess"
    from recent
    group by 1, 2
    order by sessions desc
    limit 50
  ),
  daily_rows as (
    select
      to_char(date_trunc('day', "startedAt"), 'YYYY-MM-DD') as day,
      coalesce(nullif(city, ''), 'Não informado') as city,
      coalesce(nullif(state, ''), '-') as state,
      count(*)::int as sessions
    from recent
    where "startedAt" >= now() - interval '7 days'
    group by 1, 2, 3
    order by day, sessions desc
  ),
  network_rows as (
    select coalesce(nullif("networkType", ''), 'Não informado') as network, count(*)::int as sessions
    from online
    group by 1
    order by sessions desc
  )
  select case when (select allowed from authorized) then jsonb_build_object(
    'onlineTotal', (select count(*) from online),
    'onlineLoggedIn', (select count(*) from online where "userId" is not null),
    'onlineVisitors', (select count(*) from online where "userId" is null),
    'sessions30d', (select count(*) from recent),
    'visitors30d', (select count(distinct "visitorId") from recent),
    'returningVisitors30d', (
      select count(*) from (
        select "visitorId" from recent group by "visitorId" having count(*) > 1
      ) returning_visitors
    ),
    'cities', coalesce((select jsonb_agg(to_jsonb(city_rows)) from city_rows), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily_rows)) from daily_rows), '[]'::jsonb),
    'networks', coalesce((select jsonb_agg(to_jsonb(network_rows)) from network_rows), '[]'::jsonb),
    'generatedAt', now()
  ) else '{}'::jsonb end;
$$;

create or replace function public.get_presence_commercial_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'A análise comercial está disponível somente para o administrador principal.'
      using errcode = '42501';
  end if;
  return public._presence_commercial_summary_payload();
end;
$$;

create or replace function public.purge_old_commercial_analytics(retention_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_presence bigint;
  v_telemetry bigint;
begin
  if retention_days < 7 or retention_days > 365 then
    raise exception 'O período de retenção deve ficar entre 7 e 365 dias.';
  end if;
  delete from public."AppPresenceSession"
  where "lastSeenAt" < now() - make_interval(days => retention_days);
  get diagnostics v_presence = row_count;
  delete from public."AppTelemetryEvent"
  where "createdAt" < now() - make_interval(days => retention_days);
  get diagnostics v_telemetry = row_count;
  return jsonb_build_object('presenceDeleted', v_presence, 'telemetryDeleted', v_telemetry);
end;
$$;

revoke all on function public.heartbeat_app_presence(text,text,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.end_app_presence(text) from public;
revoke all on function public.get_presence_commercial_summary() from public;
revoke all on function public._presence_commercial_summary_payload() from public;
revoke all on function public.purge_old_commercial_analytics(integer) from public;
grant execute on function public.heartbeat_app_presence(text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.end_app_presence(text) to anon, authenticated;
grant execute on function public.get_presence_commercial_summary() to authenticated;
grant execute on function public.purge_old_commercial_analytics(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'AppPresenceSession'
     ) then
    alter publication supabase_realtime add table public."AppPresenceSession";
  end if;
end $$;

comment on table public."AppPresenceSession" is
  'Sessões de presença do catálogo. Visitantes anônimos só são apresentados agregados pelo RPC comercial.';
comment on function public.get_presence_commercial_summary() is
  'Resumo agregado de presença e cidades, disponível exclusivamente ao ADMIN_MASTER.';
comment on function public.purge_old_commercial_analytics(integer) is
  'Limpeza diária de presença e telemetria conforme a retenção configurada.';

do $schedule$
begin
  if to_regclass('cron.job') is not null then
    execute $sql$
      select cron.schedule(
        'briland-commercial-analytics-retention',
        '17 3 * * *',
        'select public.purge_old_commercial_analytics(30);'
      )
      where not exists (
        select 1 from cron.job where jobname = 'briland-commercial-analytics-retention'
      )
    $sql$;
  end if;
end
$schedule$;

notify pgrst, 'reload schema';
