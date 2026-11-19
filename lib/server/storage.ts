import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const OUTPUT_DIR = path.join(process.cwd(), "output");

/** Biến ID thành tên file an toàn trên Windows. */
export function safeFileName(id: string): string {
  return id.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 120) || "image";
}
