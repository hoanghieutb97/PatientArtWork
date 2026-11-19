import { fetchImage } from "@/lib/server/remote";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  try {
    const { buffer, type } = await fetchImage(url);
    return new Response(new Uint8Array(buffer), {
      // URL ảnh cố định nên cho trình duyệt cache, chuyển lại ảnh cũ sẽ không tải lại
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định";
    return new Response(message, { status: 502 });
  }
}
