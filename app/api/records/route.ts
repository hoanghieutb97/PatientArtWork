import { NextResponse } from "next/server";
import { listRecords } from "@/lib/server/db";

export const runtime = "nodejs";

/** Danh sách bản ghi (theo thứ tự import) kèm trạng thái */
export async function GET() {
  try {
    return NextResponse.json(await listRecords());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi đọc dữ liệu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
