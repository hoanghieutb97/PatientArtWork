import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createRecord, listRecords, replaceRecord, setMeta } from "@/lib/server/db";
import type { DbRecord, Row } from "@/lib/types";

export const runtime = "nodejs";

// Cột (chỉ số bắt đầu từ 0): B = Sub-barcode (id), E = Variant, F = Product Type, I = link ảnh
const SUB_BARCODE_COL = 1;
const SKU_COL = 2;
const VARIANT_COL = 4;
const TYPE_COL = 5;
const URL_COL = 8;
// Dữ liệu bắt đầu từ dòng 2 (dòng 1 là tiêu đề)
const FIRST_DATA_ROW_INDEX = 1;

// Tiêu đề chuẩn của file đầu vào (16 cột, A..P)
const DEFAULT_HEADERS = [
  "#OrderId", "Sub-barcode", "SKU", "Quantity", "Variant", "Product Type", "Country Code", "Partner",
  "Design URL", "Date Received", "Order Name", "Location", "Item Barcode", "Order Type", "Production Note", "Status",
];

/**
 * Import Excel vào JSON server.
 * - Nếu có Sub-barcode trùng với dữ liệu đã có: trả 409 kèm danh sách mã trùng.
 *   Gửi lại với overwrite=1 để ghi đè tất cả các mã trùng.
 * - Dòng mới có trạng thái "check".
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const overwrite = form.get("overwrite") === "1";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Chưa chọn file Excel" }, { status: 400 });
  }

  try {
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return NextResponse.json({ error: "File Excel trống" }, { status: 400 });

    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
    const headers = (data[0] ?? []).map((h) => String(h ?? ""));
    const batch = new Date().toISOString();

    const incoming: DbRecord[] = [];
    const seenInFile = new Map<string, number>();
    for (let i = FIRST_DATA_ROW_INDEX; i < data.length; i++) {
      const cells = data[i];
      const url = String(cells[URL_COL] ?? "").trim();
      if (!/^https?:\/\//i.test(url)) continue; // bỏ dòng không có link ảnh

      const id = String(cells[SUB_BARCODE_COL] ?? "").trim();
      if (!id) {
        return NextResponse.json({ error: `Dòng ${i + 1} thiếu Sub-barcode (cột B)` }, { status: 400 });
      }
      if (seenInFile.has(id)) {
        return NextResponse.json(
          { error: `Sub-barcode "${id}" bị trùng trong chính file (dòng ${seenInFile.get(id)} và ${i + 1})` },
          { status: 400 },
        );
      }
      seenInFile.set(id, i + 1);

      incoming.push({
        id,
        seq: 0, // gán sau
        batch,
        row: i + 1,
        raw: cells,
        sku: String(cells[SKU_COL] ?? "").trim(),
        variant: String(cells[VARIANT_COL] ?? "").trim(),
        productType: String(cells[TYPE_COL] ?? "").trim(),
        url,
        status: "check",
        offsets: {},
        updatedAt: batch,
      });
    }

    if (incoming.length === 0) {
      return NextResponse.json({ error: "Không tìm thấy dòng có link ảnh ở cột I (từ dòng 2)" }, { status: 400 });
    }

    const existing = await listRecords();
    const existingIds = new Set(existing.map((r) => r.id));
    const duplicates = incoming.filter((r) => existingIds.has(r.id)).map((r) => r.id);

    if (duplicates.length > 0 && !overwrite) {
      return NextResponse.json(
        {
          error: `Có ${duplicates.length} Sub-barcode đã tồn tại trên server`,
          duplicates,
        },
        { status: 409 },
      );
    }

    // Gán seq nối tiếp, giữ đúng thứ tự dòng trong file
    const maxSeq = existing.reduce((m, r) => Math.max(m, r.seq), 0);
    incoming.forEach((r, i) => (r.seq = maxSeq + i + 1));

    for (const rec of incoming) {
      if (existingIds.has(rec.id)) await replaceRecord(rec);
      else await createRecord(rec);
    }
    // Tiêu đề xuất file: lấy dòng 1 nếu đúng là dòng tiêu đề (có cột Sub-barcode),
    // nếu không thì dùng tiêu đề chuẩn để không lưu nhầm dữ liệu làm tiêu đề
    const looksLikeHeader = headers.some((h) => h.trim().toLowerCase() === "sub-barcode");
    await setMeta({ headers: looksLikeHeader ? headers : DEFAULT_HEADERS, sheetName: "Barcodes" });

    const rows: Row[] = incoming.map((r) => ({
      id: r.id,
      url: r.url,
      productType: r.productType,
      variant: r.variant,
    }));
    return NextResponse.json({ rows, overwritten: duplicates.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi import";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
