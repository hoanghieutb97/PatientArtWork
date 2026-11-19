import { promises as fs } from "fs";
import path from "path";
import type { ProductConfig, ProductRule } from "@/lib/types";

export const CONFIG_FILE = path.join(process.cwd(), "config", "products.json");

const norm = (s: string) => s.trim().toLowerCase();

export function validateRule(r: ProductRule): void {
  const fail = (msg: string) => {
    throw new Error(`Khai báo "${r.name || r.productType}": ${msg}`);
  };
  if (!r.productType?.trim()) throw new Error("Product Type không được để trống");
  if (!r.variant?.trim()) fail("Variant không được để trống (dùng * nếu khớp mọi variant)");
  if (!Number.isInteger(r.cols) || r.cols < 1) fail("số ô ngang phải là số nguyên >= 1");
  if (!Number.isInteger(r.rows) || r.rows < 1) fail("số ô dọc phải là số nguyên >= 1");
  if (!Array.isArray(r.groups) || r.groups.length === 0) fail("phải có ít nhất 1 nhóm ô");

  for (const [k, info] of Object.entries(r.cells ?? {})) {
    const [c, rr] = k.split(",").map(Number);
    if (!Number.isInteger(c) || c < 1 || c > r.cols || !Number.isInteger(rr) || rr < 1 || rr > r.rows) {
      fail(`ô ${k} nằm ngoài lưới`);
    }
    if (info.color && !/^#[0-9a-f]{6}$/i.test(info.color)) fail(`màu của ô ${k} không hợp lệ`);
  }

  const used = new Set<string>();
  r.groups.forEach((group, gi) => {
    if (!Array.isArray(group) || group.length === 0) fail(`nhóm ${gi + 1} đang rỗng`);
    for (const [c, rr] of group) {
      if (!Number.isInteger(c) || c < 1 || c > r.cols) fail(`ô [${c}, ${rr}] ngoài phạm vi cột 1..${r.cols}`);
      if (!Number.isInteger(rr) || rr < 1 || rr > r.rows) fail(`ô [${c}, ${rr}] ngoài phạm vi hàng 1..${r.rows}`);
      const k = `${c},${rr}`;
      if (used.has(k)) fail(`ô [${c}, ${rr}] nằm trong nhiều nhóm`);
      used.add(k);
    }
  });
}

export function validateConfig(config: ProductConfig): void {
  const seen = new Set<string>();
  for (const r of config) {
    validateRule(r);
    const k = `${norm(r.productType)}|${norm(r.variant)}`;
    if (seen.has(k)) {
      throw new Error(`Trùng khai báo: Product Type "${r.productType}", Variant "${r.variant}"`);
    }
    seen.add(k);
  }
}

export async function readProducts(): Promise<ProductConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(CONFIG_FILE, "utf8");
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  // Định dạng cũ: { "A": {cols, rows, groups} } -> coi key là Product Type, variant "*"
  const config: ProductConfig = Array.isArray(parsed)
    ? (parsed as ProductConfig)
    : Object.entries(parsed as Record<string, Omit<ProductRule, "name" | "productType" | "variant">>).map(
        ([name, t]) => ({ ...t, name, productType: name, variant: "*" }),
      );
  validateConfig(config);
  return config;
}

export async function writeProducts(config: ProductConfig): Promise<void> {
  validateConfig(config);
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
}
