import type { Product, VehicleApplication } from "./types";

export const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1950 }, (_, index) => 1950 + index).reverse();
export const vehicleYearLabel = (item: Pick<VehicleApplication,"anoInicial"|"anoFinal">) => !item.anoInicial || !item.anoFinal ? "Todos os anos" : item.anoInicial === item.anoFinal ? String(item.anoInicial) : `${item.anoInicial} a ${item.anoFinal}`;
export const productImage = (product: Product) => product.imagemCard || product.imagemDetalhe || product.imagemPrincipal || "";
export const detailImage = (product: Product) => product.imagemDetalhe || product.imagemPrincipal || product.imagemCard || "";
type ImageTransform = { width:number; height?:number; quality?:number; resize?:"cover"|"contain"|"fill"; version?:number };
export function optimizedImageUrl(url?:string|null, options?:ImageTransform) {
  if (!url || !options) return url || "";
  const marker="/storage/v1/object/public/";
  if (!url.includes(marker)) return url;
  try {
    const parsed=new URL(url.replace(marker,"/storage/v1/render/image/public/"));
    parsed.searchParams.set("width",String(options.width));
    if(options.height)parsed.searchParams.set("height",String(options.height));
    parsed.searchParams.set("resize",options.resize||"contain");
    parsed.searchParams.set("quality",String(options.quality??80));
    if(options.version)parsed.searchParams.set("_v",String(options.version));
    return parsed.toString();
  } catch { return url; }
}
export const cardImage = (product:Product) => optimizedImageUrl(productImage(product),{width:640,height:520,quality:82,resize:"contain",version:Date.parse(product.updatedAt||"")||undefined});
export const largeProductImage = (url:string,product:Product) => optimizedImageUrl(url,{width:1400,height:1100,quality:88,resize:"contain",version:Date.parse(product.updatedAt||"")||undefined});
export const thumbnailImage = (url:string,product:Product) => optimizedImageUrl(url,{width:220,height:180,quality:76,resize:"contain",version:Date.parse(product.updatedAt||"")||undefined});
export const money = (value?:number|null) => value == null ? "Sob consulta" : value.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
export const whatsappLink = (base:string, text:string) => `${base}${base.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}`;
export const matchesYear = (application:VehicleApplication, year:number|null) => !year || (!application.anoInicial && !application.anoFinal) || ((application.anoInicial ?? 1950) <= year && (application.anoFinal ?? new Date().getFullYear()+1) >= year);
