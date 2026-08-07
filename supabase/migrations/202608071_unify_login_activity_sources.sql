-- Mantém o último login do cadastro sincronizado com a telemetria autenticada.
-- A checagem por auth.uid() impede que um usuário atualize o registro de outro.
create or replace function public.sync_user_last_login_from_telemetry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new."eventType" = 'login' and auth.uid() is not null then
    update public."User"
       set "lastLoginAt" = greatest(coalesce("lastLoginAt", new."createdAt"), new."createdAt"),
           "updatedAt" = now()
     where id = new."userId"
       and "authUserId" = auth.uid()
       and status = 'ACTIVE';
  end if;
  return new;
end;
$$;

drop trigger if exists "AppTelemetryEvent_sync_last_login" on public."AppTelemetryEvent";
create trigger "AppTelemetryEvent_sync_last_login"
after insert on public."AppTelemetryEvent"
for each row execute function public.sync_user_last_login_from_telemetry();

-- Reconcilia apenas logins já existentes; não altera perfis, permissões ou eventos.
update public."User" u
   set "lastLoginAt" = recent."lastLoginAt",
       "updatedAt" = now()
  from (
    select "userId", max("createdAt") as "lastLoginAt"
      from public."AppTelemetryEvent"
     where "eventType" = 'login' and "userId" is not null
     group by "userId"
  ) recent
 where u.id = recent."userId"
   and (u."lastLoginAt" is null or u."lastLoginAt" < recent."lastLoginAt");

revoke all on function public.sync_user_last_login_from_telemetry() from public;
