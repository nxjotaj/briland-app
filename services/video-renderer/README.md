# Briland Video Renderer

Worker isolado que consome a fila `VideoRenderJob`, cria uma composição HTML controlada,
renderiza com HyperFrames e envia o MP4 ao bucket privado `marketing-videos`.

## Execução local

1. Copie `.env.example` para `.env` e preencha as variáveis.
2. Exporte as variáveis no processo (o worker não carrega `.env` implicitamente).
3. Execute `npm ci` e `npm start` em Node.js 22 ou superior, com Chrome/Chromium e FFmpeg disponíveis.

Use exclusivamente a chave `service_role` no worker. Ela nunca deve ser exposta no `admin-web`,
em builds públicos ou em variáveis `NEXT_PUBLIC_*`.

## Contêiner

O `Dockerfile` inclui Chromium e FFmpeg. Injete os segredos no ambiente do contêiner; não os
grave na imagem. Uma única instância processa um vídeo por vez. Instâncias adicionais podem
ser executadas em paralelo porque a retirada da fila usa `FOR UPDATE SKIP LOCKED`.
