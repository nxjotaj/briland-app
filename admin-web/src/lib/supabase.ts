import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jdxbxsufqjiinkfvvbda.supabase.co";
export const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkeGJ4c3VmcWppaW5rZnZ2YmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzM3OTAsImV4cCI6MjA5NzI0OTc5MH0.g40V1rpJ8_0URRcdxVC9EzRFrJzyKK1lFL7yh3HNeHY";

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
