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

export async function uploadCatalogMedia(file: File, folder: string) {
  const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const path = `${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from("catalog-media").upload(path, file, {
    contentType: file.type,
    upsert: true
  });
  if (error) throw error;
  return supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl;
}

export async function uploadCatalogBlob(path: string, blob: Blob, contentType: string) {
  const { error } = await supabase.storage.from("catalog-media").upload(path, blob, {
    contentType,
    upsert: true
  });
  if (error) throw error;
  return supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl;
}
