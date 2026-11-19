"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Aligner from "./Aligner";
import LayoutEditor from "./LayoutEditor";
import { inkImageUrl } from "./ink";

import { cellKey, sourceRect } from "@/lib/geometry";
import { findRule } from "@/lib/match";
import type { AlignmentMap, CellOffsets, DbRecord, LayoutOverride, ProductConfig, Row } from "@/lib/types";

/** Kích thước ảnh gắn với đúng URL của nó, để không bị dùng nhầm khi chuyển ảnh */
type ImageSize = { src: string; width: number; height: number };

/** Thư mục gốc lưu ảnh từng lớp (khớp với DESIGN_DIR phía server) */
const DESIGN_ROOT = "\\\\192.168.1.240\\designImage";

/**
 * Copy văn bản vào clipboard.
 * navigator.clipboard chỉ chạy trên HTTPS hoặc localhost; mở app qua http://<ip> thì dùng cách dự phòng
 * (chọn văn bản trong ô ẩn rồi lệnh copy cũ).
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // rơi xuống cách dự phòng
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/** Pixel của ảnh gốc, cache theo URL (dùng để đo khung chi tiết) */
const pixelCache = new Map<string, Promise<ImageData>>();
function loadPixels(src: string): Promise<ImageData> {
  let p = pixelCache.get(src);
  if (!p) {
    p = new Promise<ImageData>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return reject(new Error("Trình duyệt không hỗ trợ canvas"));
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, c.width, c.height));
      };
      img.onerror = () => reject(new Error("Không đọc được pixel của ảnh"));
      img.src = src;
    });
    pixelCache.set(src, p);
    p.catch(() => pixelCache.delete(src));
  }
  return p;
}

/** Khung bao của chi tiết trong vùng rc (px ảnh gốc): bỏ pixel trong suốt và nền trắng */
function detailBounds(data: ImageData, rc: { x: number; y: number; w: number; h: number }) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = rc.y; y < rc.y + rc.h; y++) {
    for (let x = rc.x; x < rc.x + rc.w; x++) {
      const i = (y * data.width + x) * 4;
      if (data.data[i + 3] <= 128) continue;
      if (data.data[i] >= 245 && data.data[i + 1] >= 245 && data.data[i + 2] >= 245) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Màu chữ đen hoặc trắng tùy độ sáng của nền */
function textOn(hex?: string): string | undefined {
  if (!hex) return undefined;
  const n = parseInt(hex.replace("#", ""), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#1c1917" : "#ffffff";
}

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "check" | "ready" | "exported">("check");
  // null = chưa chọn loại nào (chưa hiện card); "all" = tất cả; còn lại là tên Product Type
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [products, setProducts] = useState<ProductConfig>([]);
  const [alignments, setAlignments] = useState<AlignmentMap>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [offsets, setOffsets] = useState<CellOffsets>({});
  const [groupIndex, setGroupIndex] = useState(0);
  const [activeKey, setActiveKey] = useState("");
  const [step] = useState(1); // bước phím mũi tên: 1 px (Shift = 10 px)
  const [opacity, setOpacity] = useState(1);
  const [difference, setDifference] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<ImageSize | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Đã copy đường dẫn thư mục chưa (hiện dòng "đã copy")
  const [copied, setCopied] = useState(false);
  // Hộp thoại báo lỗi khi lưu (null = không hiện)
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  // Bố cục riêng theo từng ảnh (khi khách up nhầm loại); không có thì dùng khai báo gốc
  const [layouts, setLayouts] = useState<Record<string, LayoutOverride>>({});
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [useDeclared, setUseDeclared] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });

  // Theo dõi kích thước khung hiển thị ảnh để ảnh luôn vừa khung
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // Đo kích thước NGOÀI của khung (không đổi khi có thanh cuộn) để tránh vòng lặp rung:
    // thanh cuộn hiện -> vùng nội dung nhỏ lại -> ảnh đổi cỡ -> thanh cuộn ẩn -> ...
    const measure = () => {
      const r = el.getBoundingClientRect();
      // trừ padding (8px mỗi bên) và viền (1px mỗi bên)
      setBox({ w: Math.max(0, r.width - 18), h: Math.max(0, r.height - 18) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el, { box: "border-box" });
    return () => ro.disconnect();
  }, [index, rows]);

  // Lăn chuột trên ảnh để zoom, giữ điểm dưới con trỏ đứng yên
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const next = Math.min(5, Math.max(0.5, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const ratio = next / zoom;
      pendingScroll.current = {
        x: (el.scrollLeft + cx) * ratio - cx,
        y: (el.scrollTop + cy) * ratio - cy,
      };
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [index, rows, zoom]);

  // Kéo chuột trái trên ảnh để di chuyển (khi ảnh lớn hơn khung)
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      const el = stageRef.current;
      if (!d || !el) return;
      el.scrollLeft = d.sl - (e.clientX - d.x);
      el.scrollTop = d.st - (e.clientY - d.y);
    };
    const up = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);
  const onStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !stageRef.current) return;
    e.preventDefault();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      sl: stageRef.current.scrollLeft,
      st: stageRef.current.scrollTop,
    };
    setDragging(true);
  };

  // Sau khi zoom, đặt lại vị trí cuộn
  useLayoutEffect(() => {
    const el = stageRef.current;
    const p = pendingScroll.current;
    if (el && p) {
      el.scrollLeft = p.x;
      el.scrollTop = p.y;
      pendingScroll.current = null;
    }
  }, [zoom]);
  const [inkUrls, setInkUrls] = useState<Record<string, string>>({});

  // Danh sách đã lọc theo trạng thái (check / ready / exported / tất cả)
  // Lọc theo trạng thái VÀ Product Type cùng lúc
  const inView = (r: Row, st: Record<string, string>) =>
    (statusFilter === "all" || (st[r.id] ?? "check") === statusFilter) &&
    typeFilter !== null && (typeFilter === "all" || r.productType === typeFilter);
  const view = useMemo(
    () => rows.filter((r) => inView(r, statuses)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, statuses, statusFilter, typeFilter],
  );
  // Nút Product Type: "Tất cả" + mỗi loại, kèm số item theo bộ lọc trạng thái hiện tại
  // Mặc định chọn Product Type đầu tiên khi đã có dữ liệu
  useEffect(() => {
    if (typeFilter !== null || rows.length === 0) return;
    const first = [...new Set(rows.map((r) => r.productType).filter(Boolean))].sort()[0];
    if (first) {
      setTypeFilter(first);
      setIndex(0);
    }
  }, [rows, typeFilter]);

  const typeCounts = useMemo(() => {
    const inStatus = (r: Row) =>
      statusFilter === "all" || (statuses[r.id] ?? "check") === statusFilter;
    const types = [...new Set(rows.map((r) => r.productType).filter(Boolean))].sort();
    return [
      { value: "all", label: "Tất cả", count: rows.filter(inStatus).length },
      ...types.map((t) => ({
        value: t,
        label: t,
        count: rows.filter((r) => r.productType === t && inStatus(r)).length,
      })),
    ];
  }, [rows, statuses, statusFilter]);
  const current = view[index];
  // Thư mục chứa các lớp của ảnh đang chọn: D:\designImage\<Product Type>\<SKU>
  const dirPath = current ? `${DESIGN_ROOT}\\${current.productType}\\${current.id}` : "";
  useEffect(() => setCopied(false), [dirPath]);
  const baseProduct = current ? findRule(products, current.productType, current.variant) ?? undefined : undefined;
  // Khai báo gốc (nhóm và tên ô). Bố cục riêng của ảnh (nếu có) chỉ đổi cách cắt từng ô
  const product = baseProduct;
  const layoutOverride = current ? layouts[current.id] : undefined;
  const group = product?.groups[groupIndex] ?? [];
  const imgSrc = current ? `/api/image?url=${encodeURIComponent(current.url)}` : "";
  // Chỉ dùng kích thước nếu nó thuộc đúng ảnh đang hiển thị
  const curSize = size && size.src === imgSrc ? size : null;

  // Nạp danh sách bản ghi từ JSON server: trạng thái và tọa độ đã lưu.
  // replaceRows = true thì cập nhật danh sách ảnh bên trái (dùng khi import).
  const loadRecords = async (replaceRows: boolean) => {
    const res = await fetch("/api/records");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const list = data as DbRecord[];
    const st: Record<string, string> = Object.fromEntries(list.map((r) => [r.id, r.status]));
    setStatuses(st);
    setAlignments(Object.fromEntries(list.map((r) => [r.id, r.offsets ?? {}])));
    setLayouts(
      Object.fromEntries(list.filter((r) => r.layout).map((r) => [r.id, r.layout as LayoutOverride])),
    );
    if (replaceRows) {
      setRows(list.map((r) => ({ id: r.id, url: r.url, productType: r.productType, variant: r.variant })));
      setIndex(0);
    }
    return st;
  };

  // Nạp cấu hình loại sản phẩm và tọa độ đã lưu
  useEffect(() => {
    fetch("/api/products")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setProducts(data);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Không đọc được cấu hình"));
    loadRecords(true).catch((err) =>
      setMessage(err instanceof Error ? err.message : "Không đọc được dữ liệu"),
    );
  }, []);

  // Đổi ảnh: nạp offset đã lưu, về nhóm 1 và ô đầu tiên của nhóm
  useEffect(() => {
    if (!current) return;
    setOffsets(alignments[current.id] ?? {});
    setGroupIndex(0);
    // chỉ phụ thuộc vào ảnh hiện tại, tránh reset khi lưu tọa độ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Nếu danh sách lọc ngắn lại (ví dụ vừa lưu ảnh cuối), đưa vị trí về item hợp lệ
  useEffect(() => {
    if (view.length > 0 && index >= view.length) setIndex(view.length - 1);
  }, [view.length, index]);

  // Tải trước ảnh kế tiếp để chuyển ảnh nhanh hơn
  useEffect(() => {
    const next = view[index + 1];
    if (!next) return;
    const img = new Image();
    img.src = `/api/image?url=${encodeURIComponent(next.url)}`;
  }, [index, view]);

  // Đổi nhóm hoặc loại: chọn ô đầu tiên của nhóm làm ô đang điều khiển
  useEffect(() => {
    if (group.length > 0) setActiveKey(cellKey(group[0][0], group[0][1]));
  }, [groupIndex, product]); // eslint-disable-line react-hooks/exhaustive-deps

  // Màu của từng ô trong nhóm: lấy từ khai báo (hoặc "orig" nếu tắt tô màu / ô chưa có màu)
  const groupColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [c, r] of group) {
      const k = cellKey(c, r);
      const declared = useDeclared ? product?.cells?.[k]?.color : undefined;
      out[k] = declared || "orig";
    }
    return out;
  }, [group, product, useDeclared]);

  // Ô nào được khai báo in ngược (lật ngang) trong nhóm đang xem
  const groupMirror = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [c, r] of group) {
      const k = cellKey(c, r);
      out[k] = !!product?.cells?.[k]?.mirror;
    }
    return out;
  }, [group, product]);

  // Tạo ảnh tô màu cho các màu đang được dùng (chỉ cho ảnh hiện tại)
  useEffect(() => {
    if (!imgSrc) return;
    const colors = new Set(Object.values(groupColors).filter((c) => c && c !== "orig"));
    colors.forEach((color) => {
      inkImageUrl(imgSrc, color)
        .then((url) =>
          setInkUrls((m) => (m[`${imgSrc}|${color}`] ? m : { ...m, [`${imgSrc}|${color}`]: url })),
        )
        .catch(() => setMessage("Không tạo được ảnh chi tiết màu"));
    });
  }, [groupColors, imgSrc]);

  const inkForCurrent = useMemo(() => {
    const out: Record<string, string> = {};
    const prefix = `${imgSrc}|`;
    for (const [k, v] of Object.entries(inkUrls)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
    return out;
  }, [inkUrls, imgSrc]);


  const nudge = useCallback(
    (ddx: number, ddy: number) => {
      if (!activeKey) return;
      setOffsets((o) => {
        const cur = o[activeKey] ?? { dx: 0, dy: 0 };
        return { ...o, [activeKey]: { dx: cur.dx + ddx, dy: cur.dy + ddy } };
      });
    },
    [activeKey],
  );

  // Phím mũi tên: dịch ô đang chọn, Shift = x10 bước
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const amount = (e.shiftKey ? 10 : 1) * step;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-amount, 0],
        ArrowRight: [amount, 0],
        ArrowUp: [0, -amount],
        ArrowDown: [0, amount],
      };
      const move = moves[e.key];
      if (move) {
        e.preventDefault();
        nudge(move[0], move[1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, nudge]);

  const handleImport = async (file: File) => {
    setBusy(true);
    setMessage("Đang đọc Excel...");
    try {
      const send = (overwrite: boolean) => {
        const form = new FormData();
        form.append("file", file);
        if (overwrite) form.append("overwrite", "1");
        return fetch("/api/import", { method: "POST", body: form });
      };

      let res = await send(false);
      let data = await res.json();
      if (res.status === 409) {
        const dupes: string[] = data.duplicates ?? [];
        const shown = dupes.slice(0, 30).join("\n");
        const more = dupes.length > 30 ? `\n... và ${dupes.length - 30} mã khác` : "";
        const ok = window.confirm(
          `Có ${dupes.length} Sub-barcode đã tồn tại trên server:\n${shown}${more}\n\nLưu đè TẤT CẢ các mã trùng bằng dữ liệu file mới?`,
        );
        if (!ok) {
          setMessage("Đã hủy import vì có mã trùng");
          return;
        }
        res = await send(true);
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error);

      await loadRecords(true);
      const pairs = [...new Set((data.rows as Row[]).map((r) => `${r.productType}\u0000${r.variant}`))];
      const missing = pairs
        .map((p) => p.split("\u0000"))
        .filter(([t, v]) => !findRule(products, t, v));
      const base = `Đã nạp ${data.rows.length} ảnh${data.overwritten ? `, ghi đè ${data.overwritten} mã` : ""}`;
      setMessage(
        missing.length
          ? `${base}. Chưa khai báo: ${missing.map(([t, v]) => `Product Type "${t}" / Variant "${v}"`).join("; ")}`
          : base,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Lỗi import");
    } finally {
      setBusy(false);
    }
  };

  /** Lưu tọa độ; trả về trạng thái mới của mọi item, hoặc null nếu lỗi */
  const saveOffsets = async (): Promise<Record<string, string> | null> => {
    if (!current) return null;
    try {
      const res = await fetch("/api/alignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          offsets,
          url: current.url,
          productType: current.productType,
          variant: current.variant,
          layout: layouts[current.id] ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorDialog(data.error ?? `Lưu thất bại (HTTP ${res.status})`);
        return null;
      }
      return await loadRecords(false);
    } catch (err) {
      setErrorDialog(err instanceof Error ? err.message : "Lỗi không xác định khi lưu");
      return null;
    }
  };

  /**
   * Căn giữa chi tiết: với mỗi ô trong nhóm, đặt tâm khung chi tiết (phần không trong suốt,
   * không trắng) trùng tâm nhóm. Độ lệch được tính theo px ảnh gốc, giống nudge.
   */
  const centerDetails = async () => {
    if (!product || !curSize) return;
    try {
      const data = await loadPixels(imgSrc);
      const next = { ...offsets };
      const empty: string[] = [];
      for (const [c, r] of group) {
        const k = cellKey(c, r);
        const rc = sourceRect(curSize.width, curSize.height, product.cols, product.rows, c, r, layoutOverride);
        const b = detailBounds(data, rc);
        if (!b) {
          empty.push(k);
          continue;
        }
        const cellCx = rc.x + rc.w / 2;
        const cellCy = rc.y + rc.h / 2;
        const detCx = (b.x0 + b.x1 + 1) / 2;
        const detCy = (b.y0 + b.y1 + 1) / 2;
        next[k] = { dx: Math.round(cellCx - detCx), dy: Math.round(cellCy - detCy) };
      }
      setOffsets(next);
      setMessage(
        empty.length
          ? `Căn giữa xong. Ô không có chi tiết (giữ nguyên): ${empty.join(", ")}`
          : "Đã căn giữa chi tiết cho nhóm này",
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Căn giữa chi tiết thất bại");
    }
  };

  // Enter = bấm "Lưu tọa độ" ở mọi nơi trên trang, trừ khi đang gõ trong ô nhập chữ/số
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      const t = e.target as HTMLElement;
      const typing =
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        (t.tagName === "INPUT" &&
          ["text", "number", "search", "password"].includes((t as HTMLInputElement).type));
      if (typing) return;
      // chặn Enter kích hoạt nút đang focus (ví dụ card), để chỉ lưu một lần
      e.preventDefault();
      if (!current || busy) return;
      handleSave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // đăng ký lại mỗi lần render để handleSave luôn dùng offsets mới

  /** Lưu bố cục riêng của ảnh đang chọn (hoặc bỏ để quay về khai báo gốc) */
  const saveLayoutOverride = async (layout: LayoutOverride | null) => {
    if (!current) return;
    try {
      const res = await fetch("/api/layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, layout }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorDialog(data.error ?? `Lưu bố cục thất bại (HTTP ${res.status})`);
        return;
      }
      setLayouts((m) => {
        const next = { ...m };
        if (layout) next[current.id] = layout;
        else delete next[current.id];
        return next;
      });
      setLayoutOpen(false);
      setMessage(layout ? "Đã lưu bố cục riêng cho ảnh này" : "Đã quay về khai báo gốc");
    } catch (err) {
      setErrorDialog(err instanceof Error ? err.message : "Lỗi khi lưu bố cục");
    }
  };

  const handleSave = async () => {
    setBusy(true);
    await saveOffsets();
    setBusy(false);
  };

  const goTo = (i: number) => {
    if (i >= 0 && i < view.length) setIndex(i);
  };


  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Danh sách ảnh</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <a href="/products">Khai báo loại sản phẩm →</a> · <a href="/admin">Admin →</a>
        </p>
        <label className="file-btn">
          Chọn file Excel (.xlsx)
          <input
            type="file"
            accept=".xlsx,.xls"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = "";
            }}
          />
        </label>
        {rows.length > 0 && (
          <div className="fields" style={{ marginTop: 8 }}>
            <label>
              Lọc
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as typeof statusFilter);
                  setIndex(0);
                }}
              >
                <option value="check">check</option>
                <option value="ready">ready</option>
                <option value="exported">exported</option>
                <option value="all">Tất cả</option>
              </select>
            </label>
            <div className="type-buttons">
              {typeCounts.map((t) => (
                <button
                  key={t.value}
                  className={`type-btn${typeFilter === t.value ? " active" : ""}`}
                  onClick={() => {
                    setTypeFilter(t.value);
                    setIndex(0);
                  }}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
          </div>
        )}
        <ul className="row-list">
          {view.map((r, i) => (
            <li key={`${r.id}-${i}`}>
              <button className={i === index ? "active" : ""} onClick={() => goTo(i)}>
                <span className={`dot st-${statuses[r.id] ?? "check"}`} title={statuses[r.id] ?? "check"} />
                <span>
                  {r.id}
                  {r.variant && <small className="muted" style={{ display: "block" }}>{r.variant}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="main">
        {!current && (
          <p className="muted">
            {rows.length === 0
              ? "Hãy chọn file Excel để bắt đầu."
              : "Chọn một Product Type ở danh sách bên trái để xem card."}
          </p>
        )}

        {current && (
          <>
            {dirPath && (
              <p
                className="message dir-copy"
                title="Bấm để copy đường dẫn"
                onClick={async () => {
                  if (await copyText(dirPath)) setCopied(true);
                  else setMessage("Không copy được, hãy chọn và copy thủ công");
                }}
              >
                {dirPath}
                {copied && <span className="muted"> · đã copy</span>}
              </p>
            )}
            <div className="actions save-bar">
              <button className="save-btn" onClick={handleSave} disabled={busy}>Lưu tọa độ</button>
              <button onClick={() => setLayoutOpen(true)} disabled={!baseProduct}>Chỉnh bố cục ảnh này</button>
              <button
                className="next-btn"
                onClick={async () => {
                  const nextId = view[index + 1]?.id;
                  setBusy(true);
                  const st = await saveOffsets();
                  setBusy(false);
                  if (!st) return;
                  // Tính lại danh sách lọc theo trạng thái mới, rồi tới ảnh kế tiếp
                  const newView = rows.filter((r) => inView(r, st));
                  const pos = nextId ? newView.findIndex((r) => r.id === nextId) : -1;
                  setIndex(pos >= 0 ? pos : Math.min(index, Math.max(0, newView.length - 1)));
                }}
                disabled={busy || index >= view.length - 1}
              >
                Lưu & sang ảnh tiếp
              </button>
            </div>
            <div className="split">
            {!product && (
              <p className="message">
                Chưa khai báo loại cho Product Type {`"${current.productType}"`}, Variant {`"${current.variant}"`}. Thêm ở trang khai báo.
              </p>
            )}

            {product && (
              <>

                <div className="fields group-overlay">
                  <span className="muted">Nhóm:</span>
                  {product.groups.map((_, g) => (
                    <button
                      key={g}
                      className={`group-btn${g === groupIndex ? " active" : ""}`}
                      onClick={() => setGroupIndex(g)}
                    >
                      Nhóm {g + 1}
                    </button>
                  ))}
                </div>
                <div className="fields cell-overlay">
                  <span className="muted"></span>
                  {group.map(([c, r]) => {
                    const key = cellKey(c, r);
                    const name = product.cells?.[key]?.name;
                    const declared = product.cells?.[key]?.color;
                    return (
                      <button
                        key={key}
                        className={`cell-btn${key === activeKey ? " active" : ""}`}
                        style={{ background: declared, color: textOn(declared) }}
                        onClick={() => setActiveKey(key)}
                      >
                        {name || `(${c}, ${r})`}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="zoom-overlay">
              <button onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))} title="Thu nhỏ">−</button>
              <button onClick={() => setZoom(1)} title="Về 100%">{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((z) => Math.min(5, z * 1.2))} title="Phóng to">+</button>
            </div>
            <div
              className="stage"
              ref={stageRef}
              onMouseDown={onStageMouseDown}
              onDoubleClick={() => setZoom(1)}
              style={{ cursor: dragging ? "grabbing" : "grab", userSelect: "none" }}
              title="Lăn chuột để zoom, kéo chuột trái để di chuyển, nhấp đúp để về 100%"
            >
              {/* Ảnh ẩn chỉ để đọc kích thước gốc */}
              <img
                key={imgSrc}
                src={imgSrc}
                alt=""
                style={{ display: "none" }}
                onLoad={(e) =>
                  setSize({
                    src: imgSrc,
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
                onError={() => setMessage("Không tải được ảnh từ URL này")}
              />
              {!curSize || !product ? (
                <p className="muted">{!curSize ? "Đang tải ảnh..." : ""}</p>
              ) : (
                <Aligner
                  src={imgSrc}
                  width={curSize.width}
                  height={curSize.height}
                  cols={product.cols}
                  rows={product.rows}
                  group={group}
                  offsets={offsets}
                  activeKey={activeKey}
                  cellColors={groupColors}
                  mirrorCells={groupMirror}
                  override={layoutOverride ?? null}
                  boxW={box.w}
                  boxH={box.h}
                  inkUrls={inkForCurrent}
                  opacity={opacity}
                  difference={difference}
                  zoom={zoom}
                />
              )}
            </div>

            {product && (
              <div className="controls">
                <div className="fields">
                  <button
                    className={`orig-btn${!useDeclared ? " active" : ""}`}
                    onClick={() => setUseDeclared((v) => !v)}
                    title={useDeclared ? "Đang tô màu theo khai báo. Bấm để xem ảnh gốc" : "Đang xem ảnh gốc. Bấm để tô màu theo khai báo"}
                  >
                    Hiển thị ảnh gốc
                  </button>
                  <span
                    title={`Màu của ô đang điều khiển: ${product?.cells?.[activeKey]?.color ?? "chưa có màu"}`}
                    style={{
                      display: "inline-block",
                      width: 18,
                      height: 18,
                      border: "1px solid #999",
                      background: product?.cells?.[activeKey]?.color ?? "transparent",
                    }}
                  />
                </div>

                <div className="fields">
                  <button
                    onClick={() =>
                      setOffsets((o) => {
                        const next = { ...o };
                        for (const [c, r] of group) delete next[cellKey(c, r)];
                        return next;
                      })
                    }
                  >
                    Căn giữa tất cả
                  </button>
                  <button onClick={centerDetails}>Căn giữa chi tiết</button>
                </div>

                <div className="fields">
                  <label>
                    Độ mờ các ô phụ
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={opacity}
                      disabled={difference}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                    />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={difference} onChange={(e) => setDifference(e.target.checked)} />
                    Chế độ Difference
                  </label>
                </div>

                <p className="hint">
                  Mặc định các ô trong nhóm đã khớp tâm. Chọn ô đang điều khiển (khung đỏ), rồi dùng mũi tên để dịch.
                  Shift + mũi tên: dịch x10 bước.
                </p>
              </div>
            )}
            </div>
          </>
        )}

        {message && <p className="message">{message}</p>}

        {layoutOpen && product && current && (
          <LayoutEditor
            templateCols={product.cols}
            templateRows={product.rows}
            groups={product.groups}
            initial={layoutOverride ?? null}
            onSave={(l) => saveLayoutOverride(l)}
            onReset={() => saveLayoutOverride(null)}
            onClose={() => setLayoutOpen(false)}
          />
        )}

        {errorDialog && (
          <div className="dialog-overlay" onClick={() => setErrorDialog(null)}>
            <div className="dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>Lỗi khi lưu</h3>
              <p className="dialog-text">{errorDialog}</p>
              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button className="primary" onClick={() => setErrorDialog(null)} autoFocus>
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
