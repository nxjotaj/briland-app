# Briland Native Premium

Aplicativo mobile nativo em Expo + React Native + TypeScript para catálogo Briland, com telas públicas e painel administrativo no mesmo design system fornecido.

## Rodar

```bash
npm install
npm start
```

No Windows deste ambiente, use `npm.cmd` se o PowerShell bloquear `npm.ps1`.

Use `npm start`, nao `npx expo start`, para evitar que o Expo escolha `8082`. O script limpa processos antigos nas portas do Expo e inicia fixo na `8081`.

Se o Expo Go no celular mostrar `request timed out`, use o túnel:

```bash
npm run start:tunnel
```

O modo LAN usa o IP local da máquina. Neste ambiente foi detectado `192.168.0.106`; celular e PC precisam estar na mesma rede e o firewall precisa permitir a porta `8081`.

## Login demo

- Admin real encontrado no Supabase: `faturamento@briland.com.br`
- Representante real encontrado no Supabase: `rjarep.comercial@gmail.com`
- Senha: campo visual nesta primeira versão; a validação segura deve ficar em Supabase Auth/backend.

Esta versão consome as tabelas reais do Supabase:

- `Produto`
- `Categoria`
- `Marca`
- `Aplicacao`
- `User`
- `ProductFieldPermission`
- `LeadOrcamento`
