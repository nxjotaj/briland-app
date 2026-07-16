import type { AuthSession } from "../types/domain";
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Supabase não configurado. Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY.");
}

export const CONFIG_STORAGE_KEY = "briland-admin-config";

export const supabaseRealtime = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

function requestHeaders(token?: string) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`
  };
}

export async function supabaseGet<T>(table: string, query = "select=*", token?: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: requestHeaders(token)
  });
  if (!response.ok) throw new Error(`${table}: ${await response.text()}`);
  return (await response.json()) as T[];
}

export async function supabaseRpc<T>(name: string, payload: Record<string, unknown> = {}, token?: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      ...requestHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`${name}: ${await response.text()}`);
  return (await response.json()) as T;
}

export async function supabasePost<T>(table: string, payload: Record<string, unknown>, token?: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...requestHeaders(token),
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T[];
}

export async function supabasePostMinimal(table: string, payload: Record<string, unknown>, token?: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...requestHeaders(token),
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function trackTelemetry(payload: Record<string, unknown>, token?: string) {
  try {
    await supabasePostMinimal("AppTelemetryEvent", {
      id: `tel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...payload
    }, token);
  } catch {
    // Telemetry must never block the app experience.
  }
}

export async function supabasePatch<T>(table: string, id: string, payload: Record<string, unknown>, token?: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...requestHeaders(token),
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T[];
}

export async function supabaseDelete(table: string, id: string, token?: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      ...requestHeaders(token),
      Prefer: "return=minimal"
    }
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function uploadStorageObject(uri: string, path: string, contentType: string, token?: string) {
  const file = await fetch(uri);
  const blob = await file.blob();
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/catalog-media/${path}`, {
    method: "POST",
    headers: {
      ...requestHeaders(token),
      "Content-Type": contentType,
      "cache-control": "max-age=31536000",
      "x-upsert": "true"
    },
    body: blob
  });
  if (!response.ok) throw new Error(await response.text());
  return `${SUPABASE_URL}/storage/v1/object/public/catalog-media/${path}`;
}

export async function signInWithPassword(email: string, password: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as AuthSession;
}
