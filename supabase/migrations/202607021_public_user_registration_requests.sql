begin;

alter table public."User" enable row level security;

grant insert on table public."User" to anon, authenticated;

drop policy if exists "public request user registration" on public."User";

create policy "public request user registration"
on public."User"
for insert
to anon, authenticated
with check (
  role = 'CLIENTE'::public."UserRole"
  and status = 'INACTIVE'::public."UserStatus"
  and "authUserId" is null
  and "passwordHash" = 'PENDING_APPROVAL'
);

commit;
