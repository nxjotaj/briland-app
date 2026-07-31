import type { Metadata } from "next";
import CatalogWeb from "@/components/catalog-web";
export async function generateMetadata({params}:{params:Promise<{slug?:string[]}>}):Promise<Metadata>{const {slug}=await params;const home=!slug?.length;return {robots:home?{index:true,follow:true}:{index:false,follow:false},alternates:{canonical:home?(process.env.NEXT_PUBLIC_CATALOG_WEB_URL||"https://briland-web.vercel.app"):undefined}};}
export default async function Page({params}:{params:Promise<{slug?:string[]}>}) { const {slug}=await params; return <CatalogWeb initialSegments={slug||[]}/>; }
