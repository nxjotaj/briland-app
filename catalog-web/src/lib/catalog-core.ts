import type { Product, VehicleApplication } from "./types";

export const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1950 }, (_, index) => 1950 + index).reverse();
export const vehicleYearLabel = (item: Pick<VehicleApplication,"anoInicial"|"anoFinal">) => !item.anoInicial || !item.anoFinal ? "Todos os anos" : item.anoInicial === item.anoFinal ? String(item.anoInicial) : `${item.anoInicial} a ${item.anoFinal}`;
export const productImage = (product: Product) => product.imagemCard || product.imagemDetalhe || product.imagemPrincipal || "";
export const detailImage = (product: Product) => product.imagemDetalhe || product.imagemPrincipal || product.imagemCard || "";
export const money = (value?:number|null) => value == null ? "Sob consulta" : value.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
export const whatsappLink = (base:string, text:string) => `${base}${base.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}`;
export const matchesYear = (application:VehicleApplication, year:number|null) => !year || (!application.anoInicial && !application.anoFinal) || ((application.anoInicial ?? 1950) <= year && (application.anoFinal ?? new Date().getFullYear()+1) >= year);
