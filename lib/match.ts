import type { ProductRule } from "@/lib/types";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Mẫu variant: "*" là ký tự đại diện cho chuỗi bất kỳ (kể cả rỗng).
 * Không phân biệt hoa thường, bỏ khoảng trắng đầu cuối.
 * Trả về -1 nếu không khớp, nếu khớp thì trả về số ký tự cố định (càng lớn càng cụ thể).
 */
export function variantScore(pattern: string, variant: string): number {
  const p = norm(pattern);
  const v = norm(variant);
  const escaped = p
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  if (!new RegExp(`^${escaped}$`).test(v)) return -1;
  return p.replace(/\*/g, "").length;
}

/** Tìm loại khớp nhất với (Product Type, Variant) của một dòng Excel. */
export function findRule(
  rules: ProductRule[],
  productType: string,
  variant: string,
): ProductRule | null {
  let best: ProductRule | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (norm(rule.productType) !== norm(productType)) continue;
    const score = variantScore(rule.variant, variant);
    // so sánh ">" để giữ mẫu khai báo trước khi bằng điểm
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}
