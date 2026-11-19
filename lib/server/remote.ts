/** Nhận diện loại ảnh theo nội dung file (magic bytes), không tin content-type của server. */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** Tải ảnh từ URL phía server (tránh lỗi CORS khi canvas/xuất ảnh). */
export async function fetchImage(url: string): Promise<{ buffer: Buffer; type: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL không hợp lệ");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Chỉ hỗ trợ URL http/https");
  }

  const res = await fetch(parsed, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Tải ảnh thất bại (HTTP ${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const headerType = res.headers.get("content-type") ?? "";
  // Nhiều CDN trả application/octet-stream cho file ảnh: kiểm tra nội dung thực tế
  const type = sniffImageType(buffer) ?? (headerType.startsWith("image/") ? headerType : null);
  if (!type) {
    throw new Error(`Không phải file ảnh (content-type: ${headerType || "không có"})`);
  }
  return { buffer, type };
}
