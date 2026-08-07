create or replace function public.consume_public_rate_limit(p_key text,p_limit integer default 5,p_window_seconds integer default 900)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_now timestamp without time zone:=now();v_row public."SecurityRateLimit"%rowtype;
begin
  if length(coalesce(p_key,'')) not between 16 and 180 or p_limit not between 1 and 100 or p_window_seconds not between 30 and 86400 then return false; end if;
  insert into public."SecurityRateLimit" (key,count,"resetAt","createdAt","updatedAt") values(p_key,1,v_now+make_interval(secs=>p_window_seconds),v_now,v_now)
  on conflict(key) do update set count=case when "SecurityRateLimit"."resetAt"<=v_now then 1 else "SecurityRateLimit".count+1 end,"resetAt"=case when "SecurityRateLimit"."resetAt"<=v_now then v_now+make_interval(secs=>p_window_seconds) else "SecurityRateLimit"."resetAt" end,"updatedAt"=v_now returning * into v_row;
  return v_row.count<=p_limit;
end;$$;
revoke all on function public.consume_public_rate_limit(text,integer,integer) from public;
grant execute on function public.consume_public_rate_limit(text,integer,integer) to anon,authenticated;
revoke all on table public."SecurityRateLimit" from anon,authenticated;
