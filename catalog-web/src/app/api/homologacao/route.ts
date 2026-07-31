import { NextRequest, NextResponse } from "next/server";

async function digest(value:string) { const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map(byte=>byte.toString(16).padStart(2,"0")).join(""); }
export async function POST(request:NextRequest) {
  const form=await request.formData(); const received=String(form.get("senha")||""); const expected=process.env.HOMOLOGATION_PASSWORD||"";
  const returnTo=String(form.get("retorno")||"/");
  if (!expected || received!==expected) return NextResponse.redirect(new URL(`/homologacao?erro=1&retorno=${encodeURIComponent(returnTo)}`,request.url),303);
  const response=NextResponse.redirect(new URL(returnTo.startsWith("/")?returnTo:"/",request.url),303);
  response.cookies.set("briland_web_preview",await digest(expected),{ httpOnly:true,secure:true,sameSite:"lax",maxAge:60*60*24*14,path:"/" });
  return response;
}
