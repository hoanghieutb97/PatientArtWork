import { randomInt, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { findRule } from "@/lib/match";
import { createExport, getMeta, listRecords, patchRecord } from "@/lib/server/db";
import { DESIGN_DIR } from "@/lib/server/layers";
import { readProducts } from "@/lib/server/products";

export const runtime = "nodejs";

/** Thư mục lưu các file đã xuất: \\192.168.1.240\designImage\_exports (đổi bằng EXPORT_DIR) */
export const EXPORT_DIR = process.env.EXPORT_DIR ?? path.join(DESIGN_DIR, "_exports");

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Tên file: {số lượng}_{nhãn}_{dd}_{MM}_{mã ngẫu nhiên 6 ký tự}.xlsx */
function exportFileName(count: number, label: string): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const safe = (label || "all").trim().replace(/[\\/:*?"<>|\s]+/g, "_");
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return `${count}_${safe}_${dd}_${mm}_${code}.xlsx`;
}

/**
 * Xuất xlsx giống file đầu vào: cùng tiêu đề, cùng số cột, các dòng giữ thứ tự import, từ dòng 2.
 * - ?rule=<số thứ tự khai báo>: chỉ xuất các item khớp khai báo đó.
 * - ?productType=...: chỉ xuất theo Product Type (cũ).
 * - ?status=check|ready|exported: chỉ xuất theo trạng thái.
 * Mỗi lần xuất: file được lưu vào EXPORT_DIR và ghi vào lịch sử.
 * Các bản ghi "ready" trong lần xuất chuyển thành "exported".
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const ruleParam = params.get("rule");
    const productType = params.get("productType")?.trim() ?? "";
    const statusParam = params.get("status");

    const [allRecords, meta, rules] = await Promise.all([listRecords(), getMeta(), readProducts()]);

    let records = allRecords;
    let label = "Tất cả";
    if (ruleParam !== null) {
      const rule = rules[Number(ruleParam)];
      if (!rule) return NextResponse.json({ error: "Khai báo không tồn tại" }, { status: 400 });
      records = allRecords.filter((r) => findRule(rules, r.productType, r.variant) === rule);
      label = rule.name || rule.productType;
    } else if (productType) {
      records = allRecords.filter((r) => r.productType.trim().toLowerCase() === productType.toLowerCase());
      label = productType;
    }

    let status = "tất cả";
    if (statusParam) {
      records = records.filter((r) => r.status === statusParam);
      status = statusParam;
    }

    if (records.length === 0) {
      return NextResponse.json({ error: "Không có sản phẩm nào để xuất" }, { status: 400 });
    }

    const width = meta.headers.length;
    const aoa: unknown[][] = [meta.headers];
    for (const r of records) {
      const cells = [...(r.raw ?? [])];
      while (cells.length < width) cells.push("");
      aoa.push(cells);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, meta.sheetName || "Barcodes");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    // Lưu file và ghi lịch sử
    const fileName = exportFileName(records.length, label);
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const filePath = path.join(EXPORT_DIR, fileName);
    await fs.writeFile(filePath, buffer);
    await createExport({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      fileName,
      filePath,
      label,
      status,
      count: records.length,
      skus: records.map((r) => r.id),
    });

    for (const r of records) {
      if (r.status === "ready") {
        await patchRecord(r.id, { status: "exported", updatedAt: new Date().toISOString() });
      }
    }

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Xuất xlsx thất bại";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
