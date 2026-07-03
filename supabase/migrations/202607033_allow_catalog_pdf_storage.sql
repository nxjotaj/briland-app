update storage.buckets
set
  allowed_mime_types = case
    when allowed_mime_types is null then allowed_mime_types
    when not ('application/pdf' = any(allowed_mime_types)) then allowed_mime_types || array['application/pdf']
    else allowed_mime_types
  end,
  file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
where id = 'catalog-media';
