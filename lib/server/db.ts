import type { CellOffsets, DbMeta, DbRecord, ExportRecord, Status } from "@/lib/types";

/** Địa chỉ JSON server (npm run db, cổng 3006) */
const BASE = process.env.JSON_SERVER_URL ?? "http://localhost:3006";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new Error(`Không kết nối được JSON server ở ${BASE}. Hãy chạy "npm run db".`);
  }
  if (!res.ok) throw new Error(`JSON server lỗi ${res.status} khi gọi ${path}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = (id: string) => encodeURIComponent(id);

/** Tất cả bản ghi, sắp theo thứ tự import */
export async function listRecords(): Promise<DbRecord[]> {
  const all = await call<DbRecord[]>("/records");
  return all.sort((a, b) => a.seq - b.seq || a.row - b.row);
}

export async function createRecord(rec: DbRecord): Promise<void> {
  await call("/records", { method: "POST", body: JSON.stringify(rec) });
}

export async function replaceRecord(rec: DbRecord): Promise<void> {
  await call(`/records/${enc(rec.id)}`, { method: "PUT", body: JSON.stringify(rec) });
}

export async function patchRecord(id: string, patch: Partial<DbRecord>): Promise<void> {
  await call(`/records/${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Lưu tọa độ và đặt trạng thái (mặc định "ready") */
export async function saveOffsets(id: string, offsets: CellOffsets, status: Status = "ready"): Promise<void> {
  await patchRecord(id, { offsets, status, updatedAt: new Date().toISOString() });
}

export async function getMeta(): Promise<DbMeta> {
  return call<DbMeta>("/meta");
}

export async function setMeta(meta: DbMeta): Promise<void> {
  await call("/meta", { method: "PUT", body: JSON.stringify(meta) });
}

/** Lịch sử xuất, mới nhất lên trước */
export async function listExports(): Promise<ExportRecord[]> {
  try {
    return await call<ExportRecord[]>("/exports?_sort=createdAt&_order=desc");
  } catch (err) {
    // collection chưa có (chưa xuất lần nào) thì JSON server trả 404: coi như rỗng
    if (err instanceof Error && err.message.includes("404")) return [];
    throw err;
  }
}

export async function getExport(id: string): Promise<ExportRecord> {
  return call<ExportRecord>(`/exports/${enc(id)}`);
}

export async function createExport(rec: ExportRecord): Promise<void> {
  await call("/exports", { method: "POST", body: JSON.stringify(rec) });
}
