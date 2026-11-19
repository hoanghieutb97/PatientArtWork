/**
 * Tạo ảnh "chi tiết" của một ảnh gốc: các nét tối (chi tiết) được tô bằng màu đã chọn,
 * phần nền trong suốt. Kết quả là object URL của PNG, cache theo (src, màu).
 */

const cache = new Map<string, Promise<string>>();

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Không tải được ảnh để tô màu"));
    img.src = src;
  });
}

async function build(src: string, color: string): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ canvas");
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  const { r, g, b } = hexToRgb(color);
  // Mọi điểm không trong suốt đều được tô màu đã chọn (không phụ thuộc màu gốc).
  // Alpha giữ nguyên: điểm trong suốt vẫn trong suốt.
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(data, 0, 0);

  return new Promise<string>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Tạo ảnh màu thất bại"))),
      "image/png",
    ),
  );
}

export function inkImageUrl(src: string, color: string): Promise<string> {
  const key = `${src}|${color}`;
  let p = cache.get(key);
  if (!p) {
    p = build(src, color);
    cache.set(key, p);
    // không giữ lỗi trong cache để lần sau thử lại
    p.catch(() => cache.delete(key));
  }
  return p;
}
