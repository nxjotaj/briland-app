# Review de segurança — Briland Catálogo

Atualizado em 10/07/2026.

## Corrigido e aplicado no Supabase

- A migração `202607035_enforce_server_side_product_roles.sql` foi aplicada no banco remoto.
- `requested_role` não controla mais os campos retornados; o papel é resolvido no servidor por `auth.uid()`.
- Funções internas e `save_app_setting` têm grants explícitos e mínimos.
- RLS foi confirmada no catálogo, usuários, leads, configurações, auditoria e telemetria.
- A migração `202607036_harden_telemetry.sql` limita tamanho dos campos e metadata e criou retenção de 7 a 365 dias, padrão 90.
- O painel e o app não possuem mais fallback fixo de URL/chave anon no código.
- O painel recebeu CSP, proteção contra framing, `nosniff`, Referrer Policy e Permissions Policy.
- Falhas de `save_app_setting` agora interrompem a publicação e não exibem falso sucesso.

## Segredos e ambientes

- `.env` e `.env.local` são ignorados pelo Git.
- Apenas URL e chave pública anon ficam nos clientes.
- Senha do banco deve existir somente no ambiente administrativo local e deve ser rotacionada se for exposta fora dele.
- A Vercel deve receber somente `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Auditoria de dependências

- App Expo: nenhuma vulnerabilidade alta ou crítica; 27 moderadas transitivas, principalmente Expo/PostCSS e UUID.
- Admin: `xlsx` foi removido e substituído por `exceljs`; não restaram vulnerabilidades altas ou críticas. Há quatro vulnerabilidades moderadas transitivas.

## Pendências

- Executar testes funcionais por perfil: visitante, não cliente, cliente, representante, colaborador e master.
- Agendar `purge_old_telemetry(90)` diariamente com Supabase Cron/service role.
- Executar testes de regressão com os modelos CSV/XLSX oficiais após a troca para `exceljs`.
- Validar a CSP no domínio final da Vercel e ajustar somente origens realmente necessárias.
- Fazer smoke test após deploy do painel e do app.
- Rotacionar a senha do banco fornecida durante a manutenção.
