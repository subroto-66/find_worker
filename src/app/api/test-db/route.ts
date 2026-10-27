import { NextResponse } from "next/server";
import { connectDB, query } from "@/lib/db";

export async function GET() {
  try {
    await connectDB();
    await query("SELECT 1");
    return NextResponse.json({
      success: true,
      message: "Database connected successfully",
      database: process.env.DB_NAME,
    });
  } catch (error) {
    console.error("DB test error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Database connection failed",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}