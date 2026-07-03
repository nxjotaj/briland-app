insert into public."ProductFieldPermission" (
  id,
  "fieldKey",
  "fieldLabel",
  "visibleToVisitor",
  "visibleToNonClient",
  "visibleToClient",
  "visibleToRepresentative",
  "visibleToAdmin",
  "updatedAt"
) values (
  'perm_catalog_pdf_download',
  'catalogPdfDownload',
  'Download PDF do catálogo',
  false,
  true,
  true,
  true,
  true,
  current_timestamp
)
on conflict ("fieldKey") do update set
  "fieldLabel" = excluded."fieldLabel",
  "updatedAt" = current_timestamp;

notify pgrst, 'reload schema';
