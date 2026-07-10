# Briland Catálogo

Catálogo mobile em Expo + React Native + TypeScript, painel administrativo em Next.js e backend no Supabase.

## Estrutura

- `App.tsx` e `src/`: aplicativo mobile e web via Expo.
- `admin-web/`: painel administrativo publicado separadamente na Vercel.
- `supabase/migrations/`: políticas RLS, RPCs, auditoria, storage e telemetria.
- `scripts/`: ferramentas locais de banco e desenvolvimento.

## Configuração local

Copie `.env.example` para `.env` e `admin-web/.env.example` para `admin-web/.env.local`. Os arquivos reais são ignorados pelo Git.

Variáveis do app:

```env
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Variáveis do painel:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

`SUPABASE_DATABASE_URL` é opcional e deve existir somente no ambiente local usado pelos scripts administrativos. Nunca use senha do banco ou service role no app, no painel ou na Vercel.

## Executar

```bash
npm install
npm start
```

No painel:

```bash
cd admin-web
npm install
npm run dev
```

## Validação

```bash
npm run typecheck
cd admin-web
npm run typecheck
npm run build
```

## Deploy

Na Vercel, use `admin-web` como Root Directory e configure as duas variáveis `NEXT_PUBLIC_*`. As migrações do Supabase devem ser aplicadas antes de publicar código que dependa delas.

O editor “Aparência” mantém rascunho e configuração publicada separadamente. O app consome somente `catalogAppearance`, publicado explicitamente por um `ADMIN_MASTER`.
