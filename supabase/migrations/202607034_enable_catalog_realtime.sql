do $$
declare
  realtime_table text;
  realtime_tables text[] := array[
    'Produto',
    'Categoria',
    'Marca',
    'Aplicacao',
    'Montadora',
    'ModeloVeiculo',
    'ProdutoModeloVeiculo',
    'ProdutoAplicacao',
    'ProductFieldPermission',
    'AppSetting'
  ];
begin
  foreach realtime_table in array realtime_tables loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = realtime_table
    ) and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end $$;
