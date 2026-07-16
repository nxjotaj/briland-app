import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase não configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export async function createRegistrationCredential(payload: {
  name: string;
  company?: string | null;
  phone?: string | null;
  email: string;
  cnpj?: string | null;
  registrationNotes?: string | null;
  password: string;
}) {
  const registrationClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await registrationClient.auth.signUp({
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    options: {
      emailRedirectTo: "https://briland-catalogo.vercel.app/?acao=login",
      data: {
        registration_source: "briland_catalog",
        name: payload.name.trim(),
        company: payload.company?.trim() || "Não informado",
        phone: payload.phone?.trim() || "Não informado",
        cnpj: payload.cnpj?.trim() || "Não informado",
        observacoes: payload.registrationNotes?.trim() || ""
      }
    }
  });
  if (error) throw error;
  if (!data.user) throw new Error("Não foi possível criar a credencial de acesso.");
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error("Este e-mail já possui uma conta ou solicitação de cadastro.");
  }
}

export async function uploadCatalogMedia(file: File, folder: string) {
  const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const path = `${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from("catalog-media").upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: true
  });
  if (error) throw error;
  return supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl;
}

export async function uploadCatalogBlob(path: string, blob: Blob, contentType: string) {
  const { error } = await supabase.storage.from("catalog-media").upload(path, blob, {
    contentType,
    cacheControl: "31536000",
    upsert: true
  });
  if (error) throw error;
  return supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl;
}
