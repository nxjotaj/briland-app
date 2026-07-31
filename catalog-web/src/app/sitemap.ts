import type { MetadataRoute } from "next";
export default function sitemap():MetadataRoute.Sitemap { return [{url:process.env.NEXT_PUBLIC_CATALOG_WEB_URL||"https://briland-web.vercel.app",lastModified:new Date(),changeFrequency:"weekly",priority:1}]; }
