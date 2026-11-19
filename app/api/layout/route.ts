import { NextResponse } from "next/server";
import { patchRecord } from "@/lib/server/db";
import { validateLayout } from "@/lib/layout";
import type { LayoutOverride } from "@/lib/types";

export const runtime = "nodejs";

/** Đặt bố cục riêng cho một ảnh. layout = null thì quay về khai báo gốc. */
export async function PATCH(req: Request) {
  const body = (await req.json()) as { id?: unknown; layout?: LayoutOverride | null };
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Thiếu id" }, { status: 400 });
  }
  if (body.layout) {
    const err = validateLayout(body.layout);
    if (err) return NextResponse.json({ error: `Bố cục không hợp lệ: ${err}` }, { status: 400 });
  }
  try {
    await patchRecord(body.id, { layout: body.layout ?? null, updatedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lưu bố cục thất bại";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
