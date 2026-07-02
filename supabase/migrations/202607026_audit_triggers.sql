create or replace function public.audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public."User";
  entity_id text;
begin
  select *
  into actor
  from public."User"
  where "authUserId" = auth.uid()
  limit 1;

  entity_id := coalesce(
    case when tg_op = 'DELETE' then old.id else new.id end,
    null
  );

  insert into public."AuditLog" (
    id,
    "actorUserId",
    "actorEmail",
    action,
    "entityType",
    "entityId",
    metadata
  )
  values (
    'audit_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(md5(random()::text), 1, 8),
    actor.id,
    actor.email,
    lower(tg_op),
    tg_table_name,
    entity_id,
    jsonb_build_object(
      'source', 'database-trigger',
      'before', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'after', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists "audit_Produto_changes" on public."Produto";
create trigger "audit_Produto_changes"
after insert or update or delete on public."Produto"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_Categoria_changes" on public."Categoria";
create trigger "audit_Categoria_changes"
after insert or update or delete on public."Categoria"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_Marca_changes" on public."Marca";
create trigger "audit_Marca_changes"
after insert or update or delete on public."Marca"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_Aplicacao_changes" on public."Aplicacao";
create trigger "audit_Aplicacao_changes"
after insert or update or delete on public."Aplicacao"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_LeadOrcamento_changes" on public."LeadOrcamento";
create trigger "audit_LeadOrcamento_changes"
after update or delete on public."LeadOrcamento"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_User_changes" on public."User";
create trigger "audit_User_changes"
after insert or update or delete on public."User"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_ProductFieldPermission_changes" on public."ProductFieldPermission";
create trigger "audit_ProductFieldPermission_changes"
after insert or update or delete on public."ProductFieldPermission"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_AppSetting_changes" on public."AppSetting";
create trigger "audit_AppSetting_changes"
after insert or update or delete on public."AppSetting"
for each row execute function public.audit_table_change();
