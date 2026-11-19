"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CellInfo, ProductConfig, ProductRule } from "@/lib/types";

/** Bản nháp của một ô: tên, màu, lật ngang */
type CellDraft = { name: string; color: string; mirror: boolean };

/** Bản nháp: gán ô vào nhóm (1, 2, ...) và thông tin từng ô. */
type Draft = {
  name: string;
  productType: string;
  variant: string;
  cols: number;
  rows: number;
  /** key "c,r" -> số nhóm (1, 2, ...). Ô không có trong map thì không thuộc nhóm nào */
  assign: Record<string, number>;
  cells: Record<string, CellDraft>;
};

const key = (c: number, r: number) => `${c},${r}`;

function toDraft(rule: ProductRule): Draft {
  const assign: Record<string, number> = {};
  rule.groups.forEach((group, gi) => group.forEach(([c, r]) => (assign[key(c, r)] = gi + 1)));
  const cells: Record<string, CellDraft> = {};
  for (const [k, info] of Object.entries(rule.cells ?? {})) {
    cells[k] = { name: info.name ?? "", color: info.color ?? "", mirror: !!info.mirror };
  }
  return {
    name: rule.name,
    productType: rule.productType,
    variant: rule.variant,
    cols: rule.cols,
    rows: rule.rows,
    assign,
    cells,
  };
}

function fromDraft(d: Draft): ProductRule {
  const nums = [...new Set(Object.values(d.assign))].sort((a, b) => a - b);
  const groups = nums.map((n) => {
    const list: [number, number][] = [];
    for (let r = 1; r <= d.rows; r++) {
      for (let c = 1; c <= d.cols; c++) {
        if (d.assign[key(c, r)] === n) list.push([c, r]);
      }
    }
    return list;
  });

  const cells: Record<string, CellInfo> = {};
  for (const [k, info] of Object.entries(d.cells)) {
    const name = info.name.trim();
    if (!name && !info.color && !info.mirror) continue;
    cells[k] = {
      ...(name ? { name } : {}),
      ...(info.color ? { color: info.color } : {}),
      ...(info.mirror ? { mirror: true } : {}),
    };
  }

  return {
    name: d.name.trim() || d.productType.trim(),
    productType: d.productType.trim(),
    variant: d.variant.trim(),
    cols: d.cols,
    rows: d.rows,
    groups,
    cells,
  };
}

const hue = (n: number) => `hsl(${(n * 67) % 360} 70% 80%)`;

export default function ProductsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState(0);
  /** ô đang được tô nổi (chỉ để làm nổi bật, không cần chọn để sửa) */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/products")
      .then(async (r) => {
        const data = (await r.json()) as ProductConfig | { error: string };
        if (!r.ok) throw new Error("error" in data ? data.error : "Lỗi đọc cấu hình");
        setDrafts((data as ProductConfig).map(toDraft));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không đọc được cấu hình"));
  }, []);

  const draft = drafts[selected];
  const maxGroup = useMemo(() => (draft ? Math.max(0, ...Object.values(draft.assign)) : 0), [draft]);

  const updateDraft = (patch: (d: Draft) => Draft) =>
    setDrafts((list) => list.map((d, i) => (i === selected ? patch(d) : d)));

  const setSize = (field: "cols" | "rows", value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 30) return;
    updateDraft((d) => {
      const next = { ...d, [field]: value };
      const inside = (k: string) => {
        const [c, r] = k.split(",").map(Number);
        return c <= next.cols && r <= next.rows;
      };
      // bỏ gán và thông tin các ô nằm ngoài lưới mới
      const assign = Object.fromEntries(Object.entries(d.assign).filter(([k]) => inside(k)));
      const cells = Object.fromEntries(Object.entries(d.cells).filter(([k]) => inside(k)));
      return { ...next, assign, cells };
    });
  };

  /** Sửa tên, màu, lật ngang của một ô (có hiệu lực ngay) */
  const editCell = (k: string, patch: Partial<CellDraft>) =>
    updateDraft((d) => {
      const cur = d.cells[k] ?? { name: "", color: "", mirror: false };
      return { ...d, cells: { ...d.cells, [k]: { ...cur, ...patch } } };
    });

  /** Gán một ô vào nhóm g (0 = không thuộc nhóm nào) */
  const setCellGroup = (k: string, g: number) =>
    updateDraft((d) => {
      const assign = { ...d.assign };
      if (g === 0) delete assign[k];
      else assign[k] = g;
      return { ...d, assign };
    });

  const addType = () => {
    setDrafts([...drafts, { name: "", productType: "", variant: "*", cols: 2, rows: 1, assign: {}, cells: {} }]);
    setSelected(drafts.length);
    setFocusKey(null);
  };

  const removeType = () => {
    if (!draft) return;
    if (!window.confirm(`Xóa khai báo "${draft.name || draft.productType}"?`)) return;
    setDrafts(drafts.filter((_, i) => i !== selected));
    setSelected(0);
    setFocusKey(null);
  };

  const save = async () => {
    setError("");
    setMessage("");
    const config: ProductConfig = [];
    const seen = new Set<string>();
    for (const d of drafts) {
      const rule = fromDraft(d);
      const label = rule.name || "(chưa đặt tên)";
      if (!rule.productType) return setError(`"${label}": chưa nhập Product Type`);
      if (!rule.variant) return setError(`"${label}": chưa nhập Variant (dùng * nếu khớp mọi variant)`);
      if (Object.keys(d.assign).length === 0) return setError(`"${label}": chưa gán ô nào vào nhóm`);
      const k = `${rule.productType.toLowerCase()}|${rule.variant.toLowerCase()}`;
      if (seen.has(k)) return setError(`Trùng khai báo: Product Type "${rule.productType}", Variant "${rule.variant}"`);
      seen.add(k);
      config.push(rule);
    }
    setBusy(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`Đã lưu ${config.length} khai báo vào config/products.json`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  };

  /** Tất cả các ô của lưới, theo thứ tự hàng trên xuống, cột trái sang phải */
  const allCells = draft
    ? Array.from({ length: draft.rows }, (_, ri) => ri + 1).flatMap((r) =>
        Array.from({ length: draft.cols }, (_, ci) => ({ c: ci + 1, r })),
      )
    : [];

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Khai báo loại</h2>
        <button onClick={addType} style={{ width: "100%" }}>+ Thêm khai báo</button>
        <ul className="row-list">
          {drafts.map((d, i) => (
            <li key={i}>
              <button
                className={i === selected ? "active" : ""}
                onClick={() => {
                  setSelected(i);
                  setFocusKey(null);
                }}
              >
                <span>
                  {d.name || d.productType || "(chưa đặt tên)"}
                  <small className="muted">
                    {" "}· {d.productType || "?"} / {d.variant || "?"} · {d.cols}×{d.rows}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ marginTop: 16 }}>
          <Link href="/showcase">← Quay lại Showcase</Link>
        </p>
      </aside>

      <main className="main">
        {!draft && <p className="muted">Chưa có khai báo nào. Bấm “Thêm khai báo”.</p>}

        {draft && (
          <>
            <div className="fields">
              <label>
                Tên hiển thị
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => updateDraft((d) => ({ ...d, name: e.target.value }))}
                  style={{ width: 160 }}
                />
              </label>
              <label>
                Product Type (cột F)
                <input
                  type="text"
                  value={draft.productType}
                  onChange={(e) => updateDraft((d) => ({ ...d, productType: e.target.value }))}
                  style={{ width: 160 }}
                />
              </label>
              <label>
                Variant (cột E)
                <input
                  type="text"
                  value={draft.variant}
                  onChange={(e) => updateDraft((d) => ({ ...d, variant: e.target.value }))}
                  style={{ width: 200 }}
                />
              </label>
            </div>
            <p className="hint">
              Variant: nhập tên chính xác, hoặc dùng * để khớp nhiều. Ví dụ <code>*&#47;ONE SIDE</code> khớp mọi variant kết thúc bằng <code>/ONE SIDE</code>,
              {" "}<code>ONE SIDE&#47;*</code> khớp mọi variant bắt đầu bằng <code>ONE SIDE/</code>, <code>*</code> khớp tất cả.
              Không phân biệt hoa thường. Nếu một dòng khớp nhiều khai báo, khai báo cụ thể hơn được chọn.
            </p>

            <div className="fields" style={{ marginTop: 12 }}>
              <label>
                Số ô ngang
                <input type="number" min={1} max={30} value={draft.cols} onChange={(e) => setSize("cols", Number(e.target.value))} />
              </label>
              <label>
                Số ô dọc
                <input type="number" min={1} max={30} value={draft.rows} onChange={(e) => setSize("rows", Number(e.target.value))} />
              </label>
              <button className="danger" onClick={removeType}>Xóa khai báo này</button>
            </div>

            <div className="pe-layout">
              <div className="pgrid" style={{ gridTemplateColumns: `repeat(${draft.cols}, 84px)` }}>
                {allCells.map(({ c, r }) => {
                  const k = key(c, r);
                  const g = draft.assign[k];
                  const info = draft.cells[k];
                  const color = info?.color;
                  return (
                    <button
                      key={k}
                      className={`pcell${focusKey === k ? " pcell-editing" : ""}`}
                      style={{
                        background: color || (g ? hue(g) : undefined),
                        color: color ? contrastText(color) : undefined,
                      }}
                      onClick={() => setFocusKey(k)}
                      title={`ô (${c}, ${r})`}
                    >
                      <span className="pcell-pos">{c},{r}</span>
                      {info?.name ? <span className="pcell-name">{info.name}</span> : null}
                      {info?.mirror ? <span className="pcell-pos">↔ lật</span> : null}
                      {g ? <strong>N{g}</strong> : null}
                    </button>
                  );
                })}
              </div>

              <div className="cell-table-wrap">
                <table className="admin-table cell-table">
                  <thead>
                    <tr>
                      <th>Ô</th>
                      <th>Tên ô</th>
                      <th>Màu</th>
                      <th>In ngược</th>
                      <th>Nhóm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allCells.map(({ c, r }) => {
                      const k = key(c, r);
                      const info = draft.cells[k] ?? { name: "", color: "", mirror: false };
                      const g = draft.assign[k] ?? 0;
                      return (
                        <tr
                          key={k}
                          className={focusKey === k ? "row-focus" : ""}
                          onClick={() => setFocusKey(k)}
                        >
                          <td>{c}, {r}</td>
                          <td>
                            <input
                              type="text"
                              value={info.name}
                              onChange={(e) => editCell(k, { name: e.target.value })}
                              style={{ width: 150 }}
                            />
                          </td>
                          <td>
                            <span className="inline">
                              <input
                                type="color"
                                value={info.color || "#000000"}
                                onChange={(e) => editCell(k, { color: e.target.value })}
                              />
                              <button onClick={() => editCell(k, { color: "" })} disabled={!info.color}>×</button>
                            </span>
                          </td>
                          <td className="center">
                            <input
                              type="checkbox"
                              checked={info.mirror}
                              onChange={(e) => editCell(k, { mirror: e.target.checked })}
                            />
                          </td>
                          <td>
                            <select value={g} onChange={(e) => setCellGroup(k, Number(e.target.value))}>
                              <option value={0}>—</option>
                              {Array.from({ length: maxGroup }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>Nhóm {n}</option>
                              ))}
                              <option value={maxGroup + 1}>+ Nhóm mới ({maxGroup + 1})</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="actions" style={{ marginTop: 20 }}>
              <button className="primary" onClick={save} disabled={busy}>Lưu tất cả khai báo</button>
            </div>
          </>
        )}

        {message && <p className="message">{message}</p>}
        {error && <p className="message error">{error}</p>}
      </main>
    </div>
  );
}

/** Chữ đen hoặc trắng tùy độ sáng của nền */
function contrastText(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1c1917" : "#ffffff";
}
