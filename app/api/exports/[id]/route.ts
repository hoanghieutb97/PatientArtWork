import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { getExport } from "@/lib/server/db";

export const runtime = "nodejs";

/** Tải lại file đã xuất theo id trong lịch sử */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const rec = await getExport(id);
    const buffer = await fs.readFile(rec.filePath);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rec.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không tải được file";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
