import type { Offset } from "@/lib/types";

export type Rect = { x: number; y: number; w: number; h: number };

export function cellKey(c: number, r: number): string {
  return `${c},${r}`;
}

export type SourceOverride = { cols: number; rows: number; map: Record<string, string> };

/**
 * Vùng cắt của một ô khai báo (c, r) trong ảnh W x H.
 * Không có bố cục riêng: dùng lưới khai báo (cols x rows).
 * Có bố cục riêng: lấy vùng của ô ảnh đã ánh xạ (lưới của ảnh).
 */
export function sourceRect(
  W: number,
  H: number,
  cols: number,
  rows: number,
  c: number,
  r: number,
  override?: SourceOverride | null,
): Rect {
  const mapped = override?.map[cellKey(c, r)];
  if (!override || !mapped) return cellRect(W, H, cols, rows, c, r);
  const [ic, ir] = mapped.split(",").map(Number);
  return cellRect(W, H, override.cols, override.rows, ic, ir);
}

/** Vùng cắt của ô (c, r) trong ảnh W x H chia thành cols x rows ô đều nhau. */
export function cellRect(W: number, H: number, cols: number, rows: number, c: number, r: number): Rect {
  const x0 = Math.floor(((c - 1) * W) / cols);
  const x1 = Math.floor((c * W) / cols);
  const y0 = Math.floor(((r - 1) * H) / rows);
  const y1 = Math.floor((r * H) / rows);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Đặt các ô của một nhóm sao cho tâm của mỗi ô trùng tâm nhóm,
 * rồi cộng thêm offset (dx, dy) của từng ô.
 * Trả về vị trí trên canvas (đã dịch về tọa độ không âm).
 */
export function placeCells(rects: Rect[], offsets: Offset[]) {
  const raw = rects.map((rc, i) => ({
    left: Math.round(-rc.w / 2) + offsets[i].dx,
    top: Math.round(-rc.h / 2) + offsets[i].dy,
    w: rc.w,
    h: rc.h,
  }));

  const minX = Math.min(...raw.map((p) => p.left));
  const minY = Math.min(...raw.map((p) => p.top));
  const maxX = Math.max(...raw.map((p) => p.left + p.w));
  const maxY = Math.max(...raw.map((p) => p.top + p.h));

  return {
    canvasW: maxX - minX,
    canvasH: maxY - minY,
    placements: raw.map((p) => ({ left: p.left - minX, top: p.top - minY })),
  };
}
