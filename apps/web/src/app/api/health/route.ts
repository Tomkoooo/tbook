import { dbConnect } from "@tbook/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Real health check for the Docker healthcheck / Portainer, replacing the
 * legacy stack's reuse of /api/feature-flags/maintenance for this purpose.
 */
export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ status: "degraded", reason: "DATABASE_URL not set" }, { status: 200 });
  }

  try {
    const mongoose = await dbConnect(databaseUrl);
    const ok = mongoose.connection.readyState === 1;
    return NextResponse.json({ status: ok ? "ok" : "degraded" }, { status: ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      { status: "down", reason: error instanceof Error ? error.message : "unknown error" },
      { status: 503 },
    );
  }
}
