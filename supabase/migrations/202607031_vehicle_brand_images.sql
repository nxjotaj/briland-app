alter table public."Montadora"
add column if not exists imagem text null;

notify pgrst, 'reload schema';
