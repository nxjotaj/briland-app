import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

const queries = {
  tables: `
    select
      c.relname as table_name,
      obj_description(c.oid) as comment,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
    order by c.relname;
  `,
  columns: `
    select
      table_name,
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position;
  `,
  foreignKeys: `
    select
      tc.table_name,
      kcu.column_name,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name,
      tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
    order by tc.table_name, kcu.column_name;
  `,
  indexes: `
    select tablename as table_name, indexname as index_name, indexdef
    from pg_indexes
    where schemaname = 'public'
    order by tablename, indexname;
  `,
  policies: `
    select
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname;
  `,
  functions: `
    select
      p.proname as function_name,
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_function_result(p.oid) as result_type,
      l.lanname as language,
      p.prosecdef as security_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
    order by p.proname;
  `,
  triggers: `
    select
      event_object_table as table_name,
      trigger_name,
      action_timing,
      event_manipulation,
      action_statement
    from information_schema.triggers
    where trigger_schema = 'public'
    order by event_object_table, trigger_name;
  `,
  storageBuckets: `
    select id, name, public, file_size_limit, allowed_mime_types
    from storage.buckets
    order by name;
  `
};

const result = {};

try {
  await client.connect();
  for (const [key, sql] of Object.entries(queries)) {
    const response = await client.query(sql);
    result[key] = response.rows;
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.end();
}
