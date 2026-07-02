do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public."UserRole"'::regtype
      and enumlabel = 'ADMIN_MASTER'
  ) then
    alter type public."UserRole" add value 'ADMIN_MASTER';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public."UserRole"'::regtype
      and enumlabel = 'ADMIN_COLABORADOR'
  ) then
    alter type public."UserRole" add value 'ADMIN_COLABORADOR';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public."UserRole"'::regtype
      and enumlabel = 'NAO_CLIENTE'
  ) then
    alter type public."UserRole" add value 'NAO_CLIENTE';
  end if;
end $$;
