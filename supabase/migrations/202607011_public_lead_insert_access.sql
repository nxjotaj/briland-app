begin;

alter table public."LeadOrcamento" enable row level security;

grant insert on table public."LeadOrcamento" to anon, authenticated;

drop policy if exists "public create leads" on public."LeadOrcamento";
drop policy if exists "anon authenticated create leads" on public."LeadOrcamento";

create policy "anon authenticated create leads"
on public."LeadOrcamento"
for insert
to anon, authenticated
with check (true);

commit;
