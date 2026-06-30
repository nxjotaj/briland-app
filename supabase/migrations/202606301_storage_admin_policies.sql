do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_media_public_read') then
    create policy "catalog_media_public_read"
    on storage.objects
    for select
    to public
    using (bucket_id = 'catalog-media');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_media_admin_insert') then
    create policy "catalog_media_admin_insert"
    on storage.objects
    for insert
    to authenticated
    with check (bucket_id = 'catalog-media' and public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_media_admin_update') then
    create policy "catalog_media_admin_update"
    on storage.objects
    for update
    to authenticated
    using (bucket_id = 'catalog-media' and public.is_admin())
    with check (bucket_id = 'catalog-media' and public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_media_admin_delete') then
    create policy "catalog_media_admin_delete"
    on storage.objects
    for delete
    to authenticated
    using (bucket_id = 'catalog-media' and public.is_admin());
  end if;
end $$;
