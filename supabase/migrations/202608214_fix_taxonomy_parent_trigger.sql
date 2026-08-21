-- The same trigger function serves two tables with different row shapes.
-- Read parent ids through JSON so PostgreSQL never resolves a column that does
-- not exist in the current trigger table.
create or replace function public.validate_taxonomy_parent_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  new_parent_id text;
  old_parent_id text;
begin
  if tg_table_name = 'Subcategoria' then
    new_parent_id := to_jsonb(new) ->> 'categoriaId';
    old_parent_id := to_jsonb(old) ->> 'categoriaId';
    if new_parent_id is distinct from old_parent_id and exists (
      select 1
      from public."Produto"
      where "subcategoriaId" = old.id
        and "categoriaId" <> new_parent_id
    ) then
      raise exception using message = 'Esta subcategoria possui produtos vinculados à categoria atual. Realocá-los antes de trocar a categoria.';
    end if;
  elsif tg_table_name = 'GrupoProduto' then
    new_parent_id := to_jsonb(new) ->> 'subcategoriaId';
    old_parent_id := to_jsonb(old) ->> 'subcategoriaId';
    if new_parent_id is distinct from old_parent_id and exists (
      select 1
      from public."Produto"
      where "grupoProdutoId" = old.id
        and "subcategoriaId" <> new_parent_id
    ) then
      raise exception using message = 'Este grupo possui produtos vinculados à subcategoria atual. Realocá-los antes de trocar a subcategoria.';
    end if;
  end if;
  return new;
end;
$$;
