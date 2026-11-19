import type { LayoutOverride } from "@/lib/types";

/** Kiểm tra bố cục riêng: lưới ảnh hợp lệ và mọi ô ánh xạ nằm trong lưới ảnh. */
export function validateLayout(l: LayoutOverride): string | null {
  if (!Number.isInteger(l.cols) || l.cols < 1 || l.cols > 30) return "số ô ngang của ảnh phải từ 1 đến 30";
  if (!Number.isInteger(l.rows) || l.rows < 1 || l.rows > 30) return "số ô dọc của ảnh phải từ 1 đến 30";
  if (!l.map || typeof l.map !== "object") return "thiếu bảng ánh xạ ô";
  for (const [k, v] of Object.entries(l.map)) {
    const [c, r] = String(v).split(",").map(Number);
    if (!Number.isInteger(c) || c < 1 || c > l.cols || !Number.isInteger(r) || r < 1 || r > l.rows) {
      return `ô ${k} ánh xạ tới ô ảnh ${v} nằm ngoài lưới ${l.cols}×${l.rows}`;
    }
  }
  return null;
}
