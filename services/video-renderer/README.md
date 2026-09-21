# Briland Video Renderer

Worker isolado que consome a fila `VideoRenderJob`, cria uma composição HTML controlada,
renderiza com HyperFrames e envia o MP4 ao bucket privado `marketing-videos`.

O Estúdio unificado aceita dois tipos de job:

- `catalog`: composição determinística com produto, textos e identidade Briland;
- `ai`: solicita uma cena a um provedor compatível com a API adotada pelo OpenHiggsfield e,
  depois, usa essa cena apenas como matéria-prima da composição final controlada.

No modo IA, configure `AI_VIDEO_API_BASE_URL` e `AI_VIDEO_API_KEY`. A chave fica somente no
worker. O Admin nunca recebe credenciais do provedor. O worker aceita apenas modelos presentes
na allow-list, limita downloads e normaliza a trilha do MP4 final.

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
