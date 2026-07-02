begin;

alter table public."User"
  add column if not exists phone text,
  add column if not exists cnpj text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists "registrationNotes" text,
  add column if not exists "approvedAt" timestamp without time zone,
  add column if not exists "approvedBy" text;

alter table public."User" enable row level security;

grant insert on table public."User" to anon, authenticated;

drop policy if exists "public request user registration" on public."User";

create policy "public request user registration"
on public."User"
for insert
to anon, authenticated
with check (
  role = 'CLIENTE'::public."UserRole"
  and status = 'PENDING'::public."UserStatus"
  and "authUserId" is null
  and "passwordHash" = 'PENDING_APPROVAL'
);

commit;
