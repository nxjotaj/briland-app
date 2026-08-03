import { createClient } from "@supabase/supabase-js";
import type { Automaker, Brand, CatalogData, Category, Product, Role, Settings, UserProfile, VehicleApplication, VehicleModel } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
if (!url || !key) throw new Error("Supabase não configurado para o catálogo web.");
export const supabase = createClient(url, key, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
const userFields = "id,name,company,email,role,status,phone,authUserId";

export async function loadCatalog(role:Role, token?:string):Promise<CatalogData> {
  void token;
  const [products,categories,brands,automakers,models,applications,settings,permissions] = await Promise.all([
    supabase.rpc("get_visible_products", { requested_role:role }),
    supabase.from("Categoria").select("*").eq("ativo",true).order("ordem"),
    supabase.from("Marca").select("*").eq("ativo",true).order("nome"),
    supabase.from("Montadora").select("*").eq("ativo",true).order("nome"),
    supabase.from("ModeloVeiculo").select("*").eq("ativo",true).order("nome"),
    supabase.rpc("get_visible_vehicle_applications"),
    supabase.rpc("get_app_settings"),
    supabase.rpc("get_current_product_permissions")
  ]);
  const error = [products,categories,brands,automakers,models,applications,settings].find(item=>item.error)?.error;
  if (error) throw error;
  const appSettings=(settings.data||{}) as Settings;
  return { products:(products.data||[]) as Product[], categories:(categories.data||[]) as Category[], brands:(brands.data||[]) as Brand[], automakers:(automakers.data||[]) as Automaker[], models:(models.data||[]) as VehicleModel[], applications:(applications.data||[]) as VehicleApplication[], settings:{...appSettings,permissions:(permissions.data||{}) as Record<string,boolean>} };
}

export async function currentProfile():Promise<UserProfile|null> {
  const session=(await supabase.auth.getSession()).data.session;
  if (!session) return null;
  const {data,error}=await supabase.from("User").select(userFields).eq("authUserId",session.user.id).maybeSingle();
  if (error || !data || data.status!=="ACTIVE") return null;
  return data as UserProfile;
}

export async function telemetry(eventType:string, route:string, profile:UserProfile|null, metadata:Record<string,unknown>={}) {
  try {
    const visitorId=localStorage.getItem("briland-web-visitor") || `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("briland-web-visitor",visitorId);
    await supabase.from("AppTelemetryEvent").insert({ id:crypto.randomUUID(), eventType, screen:route, route, userId:profile?.id||null, userRole:profile?.role||"VISITANTE", visitorId, success:true, metadata:{ source:"WEB_CATALOG", ...metadata } });
  } catch { /* nunca bloqueia o catálogo */ }
}
