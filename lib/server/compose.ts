import sharp from "sharp";
import { cellKey, cellRect, placeCells } from "@/lib/geometry";
import type { CellOffsets, ProductType } from "@/lib/types";

/**
 * Với mỗi nhóm của loại sản phẩm: cắt các ô, đặt trùng tâm nhau
 * (cộng offset từng ô) và ghép thành một ảnh. Trả về một buffer PNG cho mỗi nhóm.
 */
export async function exportGroups(
  input: Buffer,
  type: ProductType,
  offsets: CellOffsets,
): Promise<Buffer[]> {
  const meta = await sharp(input).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("Ảnh không hợp lệ");

  const results: Buffer[] = [];
  for (const group of type.groups) {
    const rects = group.map(([c, r]) => cellRect(W, H, type.cols, type.rows, c, r));
    const offs = group.map(([c, r]) => offsets[cellKey(c, r)] ?? { dx: 0, dy: 0 });
    const layout = placeCells(rects, offs);

    const parts = await Promise.all(
      rects.map((rc) =>
        sharp(input).extract({ left: rc.x, top: rc.y, width: rc.w, height: rc.h }).png().toBuffer(),
      ),
    );

    const png = await sharp({
      create: {
        width: layout.canvasW,
        height: layout.canvasH,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(parts.map((input, i) => ({ input, left: layout.placements[i].left, top: layout.placements[i].top })))
      .png()
      .toBuffer();

    results.push(png);
  }
  return results;
}
