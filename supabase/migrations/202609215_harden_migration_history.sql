begin;

alter table if exists public._prisma_migrations enable row level security;
revoke all on table public._prisma_migrations from anon, authenticated;

commit;
