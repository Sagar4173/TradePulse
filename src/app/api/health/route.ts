import { NextResponse, connection } from "next/server";

import { getPrismaClient } from "@/lib/db";

type CheckStatus = "up" | "down";

type HealthCheckResponse = {
  status: "ok" | "degraded";
  service: "tradepulse";
  timestamp: string;
  checks: {
    application: {
      status: "up";
    };
    database: {
      status: CheckStatus;
    };
  };
};

export async function GET() {
  // Health is request-time data and must never be cached or prerendered.
  await connection();

  let databaseStatus: CheckStatus = "down";

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    databaseStatus = "up";
  } catch (error) {
    // Never log the raw error: driver/URL errors can include connection details.
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unknown";

    console.error(`Health check database probe failed (code: ${code}).`);
  }

  const isHealthy = databaseStatus === "up";
  const body: HealthCheckResponse = {
    status: isHealthy ? "ok" : "degraded",
    service: "tradepulse",
    timestamp: new Date().toISOString(),
    checks: {
      application: { status: "up" },
      database: { status: databaseStatus },
    },
  };

  return NextResponse.json(body, {
    status: isHealthy ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
