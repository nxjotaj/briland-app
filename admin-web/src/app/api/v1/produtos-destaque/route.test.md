# Contrato de validação — produtos em destaque

- Sem `x-api-key`: responde `401`.
- Chave inválida: responde `401`.
- `page=0`, texto ou `limit>100`: responde `400`.
- Chave válida: responde `200`, paginação e somente produtos ativos destacados.
- O item não contém preço, estoque, EAN, NCM ou campos internos.
- `catalogUrl` abre o detalhe do produto no catálogo Briland.
- A resposta usa `Cache-Control: no-store`.
