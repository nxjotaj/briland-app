import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (String(body.website || "") || !Number(body.startedAt) || Date.now() - Number(body.startedAt) < 1800) {
      return NextResponse.json({ accepted: true });
    }
    const { data: allowed, error: rateError } = await supabase.rpc("consume_public_rate_limit", {
      p_key: `signup:${hash(`${ip}:${email}`)}`,
      p_limit: 4,
      p_window_seconds: 3600
    });
    if (rateError || !allowed) return NextResponse.json({ error: "Muitas tentativas. Aguarde antes de tentar novamente." }, { status: 429 });
    if (!email || String(body.senha || "").length < 8) return NextResponse.json({ error: "Confira o e-mail e use uma senha com pelo menos 8 caracteres." }, { status: 400 });
    const { data, error } = await supabase.auth.signUp({
      email,
      password: String(body.senha),
      options: {
        emailRedirectTo: `${request.nextUrl.origin}/login`,
        data: {
          registration_source: "briland_catalog",
          name: String(body.nome || "").trim(),
          company: String(body.empresa || "").trim(),
          phone: String(body.telefone || "").trim(),
          cnpj: String(body.cnpj || "").trim(),
          observacoes: String(body.observacoes || "").trim()
        }
      }
    });
    if (error) throw error;
    if (data.session) await supabase.auth.signOut({ scope: "local" });
    return NextResponse.json({ accepted: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível concluir o cadastro agora. Tente novamente mais tarde." }, { status: 400 });
  }
}
