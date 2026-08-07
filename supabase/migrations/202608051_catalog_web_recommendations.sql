create or replace function public.get_catalog_popular_product_ids(result_limit integer default 24)
returns table("productId" text, score bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    event.metadata ->> 'productId' as "productId",
    sum(case event."eventType"
      when 'quote_start' then 6
      when 'whatsapp_open' then 5
      when 'favorite_toggle' then 3
      when 'product_share' then 3
      else 1
    end)::bigint as score
  from public."AppTelemetryEvent" event
  where event."createdAt" >= now() - interval '30 days'
    and event."eventType" in ('product_view','quote_start','whatsapp_open','favorite_toggle','product_share')
    and nullif(event.metadata ->> 'productId','') is not null
  group by event.metadata ->> 'productId'
  order by score desc, max(event."createdAt") desc
  limit least(greatest(coalesce(result_limit,24),1),100);
$$;

revoke all on function public.get_catalog_popular_product_ids(integer) from public;
grant execute on function public.get_catalog_popular_product_ids(integer) to anon, authenticated;
