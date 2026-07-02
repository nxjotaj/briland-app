do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'public."UserStatus"'::regtype
      and enumlabel = 'PENDING'
  ) then
    alter type public."UserStatus" add value 'PENDING' before 'ACTIVE';
  end if;
end $$;
