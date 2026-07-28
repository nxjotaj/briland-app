import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const databaseUrl = process.env.SUPABASE_DATABASE_URL?.trim();
const showcaseApiKey = process.env.BRILAND_SHOWCASE_API_KEY?.trim();
const catalogBaseUrl = (process.env.BRILAND_CATALOG_URL || "https://briland-catalogo.vercel.app").replace(/\/+$/, "");
const globalForPool = globalThis as typeof globalThis & { brilandShowcasePool?: Pool };

function getPool() {
  if (!databaseUrl) throw new Error("Configuração privada do banco indisponível.");
  globalForPool.brilandShowcasePool ??= new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 8_000,
    ssl: { rejectUnauthorized: false }
  });
  return globalForPool.brilandShowcasePool;
}

function safeKeyMatches(received: string | null) {
  if (!received || !showcaseApiKey) return false;
  const expectedBuffer = Buffer.from(showcaseApiKey);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function positiveInteger(value: string | null, fallback: number) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function recordApiUsage(payload: { success: boolean; page?: number; limit?: number; returned?: number; message?: string; origin?: string | null }) {
  try {
    await getPool().query(
      `insert into public."AppTelemetryEvent"
        (id, "eventType", screen, route, success, message, metadata, "createdAt")
       values ($1, 'showcase_api_request', 'api', '/api/v1/produtos-destaque', $2, $3, $4::jsonb, now())`,
      [crypto.randomUUID(), payload.success, payload.message?.slice(0, 1000) || null, JSON.stringify({
        page: payload.page,
        limit: payload.limit,
        returned: payload.returned,
        origin: payload.origin?.slice(0, 200) || "Não informado"
      })]
    );
  } catch {
    // A telemetria nunca pode impedir a consulta da vitrine.
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin") || request.headers.get("referer");
  if (!showcaseApiKey) {
    await recordApiUsage({ success: false, message: "API não configurada.", origin });
    return json({ error: "API temporariamente indisponível." }, 500);
  }
  if (!safeKeyMatches(request.headers.get("x-api-key"))) {
    await recordApiUsage({ success: false, message: "Chave ausente ou inválida.", origin });
    return json({ error: "Acesso não autorizado." }, 401);
  }

  const page = positiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const limit = positiveInteger(request.nextUrl.searchParams.get("limit"), 20);
  if (page == null || limit == null || limit > 100) {
    await recordApiUsage({ success: false, message: "Paginação inválida.", origin });
    return json({ error: "Use page maior que zero e limit entre 1 e 100." }, 400);
  }

  try {
    const offset = (page - 1) * limit;
    const [countResult, productsResult] = await Promise.all([
      getPool().query<{ total: string }>(`select count(*)::text as total from public."Produto" where ativo = true and destaque = true`),
      getPool().query<{
        id: string; codigoInterno: string | null; nome: string; slug: string | null; imageUrl: string | null;
        descricaoCurta: string | null; descricaoCompleta: string | null; caixaMaster: string | null; updatedAt: string | null;
        categoriaId: string | null; categoriaNome: string | null; categoriaSlug: string | null;
        marcaId: string | null; marcaNome: string | null; marcaSlug: string | null; marcaLogo: string | null;
      }>(
        `select p.id, p."codigoInterno", p.nome, p.slug,
           coalesce(p."imagemCard", p."imagemDetalhe", p."imagemPrincipal") as "imageUrl",
           p."descricaoCurta", p."descricaoCompleta", p."caixaMaster", p."updatedAt",
           c.id as "categoriaId", c.nome as "categoriaNome", c.slug as "categoriaSlug",
           m.id as "marcaId", m.nome as "marcaNome", m.slug as "marcaSlug", m.logo as "marcaLogo"
         from public."Produto" p
         left join public."Categoria" c on c.id = p."categoriaId"
         left join public."Marca" m on m.id = p."marcaId"
         where p.ativo = true and p.destaque = true
         order by p.ordem asc nulls last, p.nome asc
         limit $1 offset $2`,
        [limit, offset]
      )
    ]);

    const total = Number(countResult.rows[0]?.total || 0);
    const items = productsResult.rows.map((product) => ({
      id: product.id,
      codigoInterno: product.codigoInterno,
      nome: product.nome,
      slug: product.slug,
      imageUrl: product.imageUrl,
      descricaoCurta: product.descricaoCurta,
      descricaoCompleta: product.descricaoCompleta,
      caixaMaster: product.caixaMaster,
      categoria: product.categoriaId ? { id: product.categoriaId, nome: product.categoriaNome, slug: product.categoriaSlug } : null,
      marca: product.marcaId ? { id: product.marcaId, nome: product.marcaNome, slug: product.marcaSlug, logo: product.marcaLogo } : null,
      catalogUrl: `${catalogBaseUrl}/?produto=${encodeURIComponent(product.slug || product.codigoInterno || product.id)}`,
      destaque: true,
      updatedAt: product.updatedAt
    }));

    await recordApiUsage({ success: true, page, limit, returned: items.length, origin });
    return json({ page, limit, total, totalPages: Math.ceil(total / limit), items });
  } catch {
    await recordApiUsage({ success: false, page, limit, message: "Falha ao consultar produtos.", origin });
    return json({ error: "Não foi possível consultar os produtos neste momento." }, 500);
  }
}
