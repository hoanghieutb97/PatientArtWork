import { NextResponse } from "next/server";
import { readProducts, writeProducts } from "@/lib/server/products";
import type { ProductConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await readProducts());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi đọc cấu hình";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const config = (await req.json()) as ProductConfig;
  if (!Array.isArray(config)) {
    return NextResponse.json({ error: "Dữ liệu phải là danh sách khai báo" }, { status: 400 });
  }
  try {
    await writeProducts(config);
    return NextResponse.json(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lưu cấu hình thất bại";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
