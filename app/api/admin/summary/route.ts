import { NextResponse } from "next/server";
import { findRule } from "@/lib/match";
import { listRecords } from "@/lib/server/db";
import { readProducts } from "@/lib/server/products";

export const runtime = "nodejs";

type Counts = { check: number; ready: number; exported: number; all: number };
const zero = (): Counts => ({ check: 0, ready: 0, exported: 0, all: 0 });

/**
 * Đếm sản phẩm theo từng khai báo (Product Type + mẫu Variant).
 * Item không khớp khai báo nào được gom vào dòng "chưa khai báo" (ruleIndex = null).
 */
export async function GET() {
  try {
    const [records, rules] = await Promise.all([listRecords(), readProducts()]);

    const groups = new Map<
      string,
      { ruleIndex: number | null; productType: string; variant: string; ruleName: string; counts: Counts }
    >();
    const total = zero();

    for (const r of records) {
      const rule = findRule(rules, r.productType, r.variant);
      const idx = rule ? rules.indexOf(rule) : null;
      const key = idx !== null ? `rule:${idx}` : `none:${r.productType}|${r.variant}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          ruleIndex: idx,
          productType: rule?.productType ?? (r.productType || "(trống)"),
          variant: rule?.variant ?? (r.variant || "(trống)"),
          ruleName: rule?.name ?? "",
          counts: zero(),
        };
        groups.set(key, g);
      }
      if (r.status === "check" || r.status === "ready" || r.status === "exported") {
        g.counts[r.status] += 1;
        total[r.status] += 1;
      }
      g.counts.all += 1;
      total.all += 1;
    }

    const rows = [...groups.values()]
      .sort(
        (a, b) =>
          (a.ruleIndex ?? Number.MAX_SAFE_INTEGER) - (b.ruleIndex ?? Number.MAX_SAFE_INTEGER) ||
          a.productType.localeCompare(b.productType),
      )
      .map((g) => ({
        ruleIndex: g.ruleIndex,
        productType: g.productType,
        variant: g.variant,
        ruleName: g.ruleName,
        ...g.counts,
      }));

    return NextResponse.json({ total, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi đọc dữ liệu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
