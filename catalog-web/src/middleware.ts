import { NextRequest, NextResponse } from "next/server";

async function digest(value:string) {
  const data=new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data))).map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function middleware(request:NextRequest) {
  const password=process.env.HOMOLOGATION_PASSWORD;
  if (!password || request.nextUrl.pathname.startsWith("/homologacao") || request.nextUrl.pathname.startsWith("/api/homologacao")) return NextResponse.next();
  const expected=await digest(password);
  if (request.cookies.get("briland_web_preview")?.value===expected) return NextResponse.next();
  const url=request.nextUrl.clone(); url.pathname="/homologacao"; url.searchParams.set("retorno",request.nextUrl.pathname+request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config={ matcher:["/((?!_next/static|_next/image|favicon.ico).*)"] };
