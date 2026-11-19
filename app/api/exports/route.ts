import { NextResponse } from "next/server";
import { listExports } from "@/lib/server/db";

export const runtime = "nodejs";

/** Lịch sử các lần xuất, mới nhất lên trước */
export async function GET() {
  try {
    return NextResponse.json(await listExports());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi đọc lịch sử";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
