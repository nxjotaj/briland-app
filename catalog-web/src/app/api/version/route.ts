import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const version = process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_URL
    || process.env.VERCEL_GIT_COMMIT_SHA
    || "development";
  return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
