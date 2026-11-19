import { NextResponse } from "next/server";
import { findRule } from "@/lib/match";
import { listRecords, saveOffsets } from "@/lib/server/db";
import { saveLayers, saveOriginal, DESIGN_DIR } from "@/lib/server/layers";
import { validateLayout } from "@/lib/layout";
import { readProducts } from "@/lib/server/products";
import { fetchImage } from "@/lib/server/remote";
import type { AlignmentMap, CellOffsets, LayoutOverride } from "@/lib/types";

export const runtime = "nodejs";

/** Tọa độ đã lưu của mọi bản ghi: id -> offsets */
export async function GET() {
  try {
    const map: AlignmentMap = {};
    for (const r of await listRecords()) map[r.id] = r.offsets ?? {};
    return NextResponse.json(map);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi đọc tọa độ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Lưu tọa độ: xuất ảnh từng lớp vào D:\designImage\<Product Type>\,
 * rồi lưu tọa độ và chuyển trạng thái sang "ready".
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    id?: unknown;
    offsets?: unknown;
    url?: unknown;
    productType?: unknown;
    variant?: unknown;
    layout?: unknown;
  };
  if (
    typeof body.id !== "string" ||
    typeof body.url !== "string" ||
    typeof body.productType !== "string" ||
    typeof body.variant !== "string" ||
    !body.offsets ||
    typeof body.offsets !== "object"
  ) {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }
  const offsets = body.offsets as CellOffsets;
  for (const o of Object.values(offsets)) {
    if (!Number.isInteger(o.dx) || !Number.isInteger(o.dy)) {
      return NextResponse.json({ error: "dx, dy phải là số nguyên" }, { status: 400 });
    }
  }

  try {
    const rule = findRule(await readProducts(), body.productType, body.variant);
    if (!rule) {
      return NextResponse.json(
        { error: `Chưa khai báo loại cho Product Type "${body.productType}", Variant "${body.variant}"` },
        { status: 400 },
      );
    }
    // bố cục riêng (nếu có): lưới thật của ảnh + ánh xạ từng ô khai báo sang ô ảnh
    const layout = body.layout as LayoutOverride | null | undefined;
    if (layout) {
      const err = validateLayout(layout);
      if (err) throw new Error(`Bố cục không hợp lệ: ${err}`);
      const missing = rule.groups.flat().filter(([c, r]) => !layout.map[`${c},${r}`]);
      if (missing.length) {
        throw new Error(`Chưa ánh xạ đủ ô: ${missing.map(([c, r]) => `${c},${r}`).join("; ")}`);
      }
    }

    const { buffer, type } = await fetchImage(body.url);
    const files = await saveLayers(buffer, rule, body.id, offsets, layout);
    // Ảnh gốc, tên file đúng bằng SKU
    files.push(await saveOriginal(buffer, type, rule, body.id));
    await saveOffsets(body.id, offsets, "ready");
    return NextResponse.json({ files, dir: `${DESIGN_DIR}\\${rule.productType}\\${body.id}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lưu thất bại";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
