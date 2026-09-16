alter table public."SalesOrder"
  add column if not exists "adminSeenAt" timestamptz,
  add column if not exists "adminSeenBy" text references public."User"(id) on delete set null;

create index if not exists "SalesOrder_admin_unseen_idx"
  on public."SalesOrder" ("submittedAt" asc)
  where status = 'SUBMITTED' and "adminSeenAt" is null;

create or replace function public.reset_sales_order_admin_seen()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status = 'SUBMITTED' and old.status is distinct from 'SUBMITTED' then
    new."adminSeenAt" := null;
    new."adminSeenBy" := null;
  end if;
  return new;
end
$$;

drop trigger if exists "sales_order_reset_admin_seen" on public."SalesOrder";
create trigger "sales_order_reset_admin_seen"
before update of status on public."SalesOrder"
for each row execute function public.reset_sales_order_admin_seen();

create or replace function public.mark_sales_order_admin_seen(p_order_id text)
returns public."SalesOrder"
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public."User";
  result public."SalesOrder";
begin
  select * into actor from public.current_app_user();
  if actor.id is null or actor.role::text not in ('ADMIN', 'ADMIN_MASTER') then
    raise exception using errcode='42501', message='Somente o administrador master pode confirmar a visualização do pedido.';
  end if;

  update public."SalesOrder"
  set "adminSeenAt" = coalesce("adminSeenAt", now()),
      "adminSeenBy" = coalesce("adminSeenBy", actor.id),
      "updatedAt" = now()
  where id = p_order_id and status = 'SUBMITTED'
  returning * into result;

  if result.id is null then
    raise exception 'Pedido enviado não encontrado.';
  end if;
  return result;
end
$$;

revoke all on function public.mark_sales_order_admin_seen(text) from public;
grant execute on function public.mark_sales_order_admin_seen(text) to authenticated;
