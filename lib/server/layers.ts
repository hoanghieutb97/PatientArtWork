import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { cellKey, placeCells, sourceRect, type SourceOverride } from "@/lib/geometry";
import type { CellOffsets, ProductRule } from "@/lib/types";

/** Thư mục gốc lưu ảnh từng lớp: D:\designImage\<Product Type>\ */
export const DESIGN_DIR = process.env.DESIGN_DIR ?? "\\\\192.168.1.240\\designImage";

/** Làm sạch tên file/thư mục: chỉ bỏ ký tự không được phép trên Windows, giữ khoảng trắng. */
const clean = (s: string) => s.trim().replace(/[\\/:*?"<>|]+/g, "_") || "_";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Lưu ảnh gốc vào cùng thư mục SKU, tên file đúng bằng SKU: {SKU}.{đuôi} */
export async function saveOriginal(
  input: Buffer,
  type: string,
  rule: ProductRule,
  sku: string,
): Promise<string> {
  const dir = path.join(DESIGN_DIR, clean(rule.productType), clean(sku));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${clean(sku)}.${EXT_BY_TYPE[type] ?? "png"}`);
  await fs.writeFile(file, input);
  return file;
}

/**
 * Lưu từng ô thành một file PNG trong suốt: {SKU}_nhom{g}_{tên ô}.png
 * Mỗi lớp có cùng kích thước khung của nhóm và đã đặt đúng vị trí theo tọa độ căn chỉnh.
 */
export async function saveLayers(
  input: Buffer,
  rule: ProductRule,
  sku: string,
  offsets: CellOffsets,
  override?: SourceOverride | null,
): Promise<string[]> {
  const meta = await sharp(input).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("Ảnh không hợp lệ");

  // D:\designImage\<Product Type>\<SKU>\
  const dir = path.join(DESIGN_DIR, clean(rule.productType), clean(sku));
  await fs.mkdir(dir, { recursive: true });

  const written: string[] = [];
  for (let gi = 0; gi < rule.groups.length; gi++) {
    const group = rule.groups[gi];
    const rects = group.map(([c, r]) => sourceRect(W, H, rule.cols, rule.rows, c, r, override));
    const offs = group.map(([c, r]) => offsets[cellKey(c, r)] ?? { dx: 0, dy: 0 });
    const layout = placeCells(rects, offs);

    for (let i = 0; i < group.length; i++) {
      const [c, r] = group[i];
      const rc = rects[i];
      let part = await sharp(input)
        .extract({ left: rc.x, top: rc.y, width: rc.w, height: rc.h })
        .png()
        .toBuffer();
      // ô được khai báo "in ngược": lật ngang nội dung ô
      if (rule.cells?.[cellKey(c, r)]?.mirror) {
        part = await sharp(part).flop().png().toBuffer();
      }

      const layer = await sharp({
        create: {
          width: layout.canvasW,
          height: layout.canvasH,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: part, left: layout.placements[i].left, top: layout.placements[i].top }])
        // 300 ppi: ghi vào metadata pHYs của PNG (kích thước pixel không đổi)
        .withMetadata({ density: 300 })
        .png()
        .toBuffer();

      const cellName = rule.cells?.[cellKey(c, r)]?.name?.trim() || `${c}_${r}`;
      // file: <tên nhóm>_<tên ô>.png (tên nhóm mặc định là nhomN)
      const file = path.join(dir, `${clean(`nhom${gi + 1}`)}_${clean(cellName)}.png`);
      await fs.writeFile(file, layer);
      written.push(file);
    }
  }
  return written;
}
