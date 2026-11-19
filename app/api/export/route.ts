import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { exportGroups } from "@/lib/server/compose";
import { saveOffsets } from "@/lib/server/db";
import { fetchImage } from "@/lib/server/remote";
import { readProducts } from "@/lib/server/products";
import { OUTPUT_DIR, safeFileName } from "@/lib/server/storage";
import { findRule } from "@/lib/match";
import type { CellOffsets } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    id?: unknown;
    url?: unknown;
    productType?: unknown;
    variant?: unknown;
    offsets?: unknown;
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

  try {
    const rule = findRule(await readProducts(), body.productType, body.variant);
    if (!rule) {
      return NextResponse.json(
        { error: `Chưa khai báo loại cho Product Type "${body.productType}", Variant "${body.variant}"` },
        { status: 400 },
      );
    }

    const { buffer } = await fetchImage(body.url);
    const images = await exportGroups(buffer, rule, offsets);

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const files: string[] = [];
    for (let g = 0; g < images.length; g++) {
      const file = path.join(OUTPUT_DIR, `${safeFileName(body.id)}_nhom${g + 1}.png`);
      await fs.writeFile(file, images[g]);
      files.push(file);
    }
    // Xuất ảnh cũng là lúc tọa độ được chốt: lưu và đặt trạng thái ready
    await saveOffsets(body.id, offsets, "ready");

    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Xuất ảnh thất bại";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
