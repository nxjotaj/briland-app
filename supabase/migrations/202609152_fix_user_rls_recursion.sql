-- Evita recursão de RLS ao resolver o representante autenticado na própria tabela User.
drop policy if exists "representative reads linked clients" on public."User";

create policy "representative reads linked clients"
on public."User"
for select
to authenticated
using (
  "representanteId" = (select (public.current_app_user()).id)
  and (select (public.current_app_user()).role) = 'REPRESENTANTE'
  and (select (public.current_app_user()).status) = 'ACTIVE'
);

