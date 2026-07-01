# Briland Admin Web

Painel administrativo web separado do app nativo Briland.

## Local

```bash
npm install
npm run dev
```

## Variáveis de ambiente

Configure na Vercel, com root directory `admin-web`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://jdxbxsufqjiinkfvvbda.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Acesso

O login usa Supabase Auth. Após autenticar, o painel consulta a tabela `User` e permite acesso apenas quando:

- `authUserId` corresponde ao usuário autenticado
- `role = ADMIN`
- `status = ACTIVE`

## Dados

Todas as alterações são gravadas diretamente nas tabelas/RPCs/bucket já usados pelo app:

- `Produto`, `Categoria`, `Marca`, `Aplicacao`
- `LeadOrcamento`, `User`, `ProductFieldPermission`
- `AppSetting` via `save_app_setting`
- bucket `catalog-media`
