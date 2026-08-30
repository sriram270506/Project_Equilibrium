import { prisma } from "@/src/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Verify database connectivity
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      success: true,
      data: {
        status: "operational",
        mode: process.env.APP_MODE || "demo",
        provider: process.env.RAZORPAY_MODE || "mock",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "HEALTH_CHECK_FAILED",
          message: "Database connectivity error",
        },
      },
      { status: 500 }
    );
  }
}
