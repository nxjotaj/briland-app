import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const expectedKey = process.env.HIGHLIGHTS_API_KEY;
  if (!expectedKey || request.headers.get("x-api-key") !== expectedKey) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401 });
  const page = Number(request.nextUrl.searchParams.get("page") || 1); const limit = Number(request.nextUrl.searchParams.get("limit") || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: "Paginação inválida." }, { status: 400 });
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !publicKey) throw new Error("API não configurada");
    const db = createClient(url, publicKey, { auth: { persistSession: false } }); const from = (page - 1) * limit;
    const { data, error } = await db.rpc("get_featured_products_api", { p_offset: from, p_limit: limit });
    if (error) throw error;
    const base = (process.env.NEXT_PUBLIC_CATALOG_WEB_URL || request.nextUrl.origin).replace(/\/$/, "");
    const total = Number(data?.[0]?.total || 0); const items = (data || []).map((row: any) => ({ ...row.item, catalogUrl: `${base}/produto/${encodeURIComponent(row.item.slug || row.item.id)}` }));
    return NextResponse.json({ page, limit, total, totalPages: Math.ceil(total / limit), items }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Serviço temporariamente indisponível." }, { status: 500 }); }
}
