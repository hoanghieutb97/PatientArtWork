"use client";

import { useState } from "react";
import { cellKey } from "@/lib/geometry";
import type { LayoutOverride } from "@/lib/types";

type TemplateCell = { c: number; r: number; group: number };

type Props = {
  /** các ô của khai báo gốc, theo nhóm (lấy từ /products, không đổi ở đây) */
  templateCols: number;
  templateRows: number;
  groups: [number, number][][];
  /** bố cục riêng hiện có của ảnh (nếu có) */
  initial: LayoutOverride | null;
  onSave: (layout: LayoutOverride) => void;
  onReset: () => void;
  onClose: () => void;
};

/**
 * Chỉnh bố cục riêng cho một ảnh khi ảnh thật khác khai báo.
 * Ví dụ khai báo 1×3, ảnh thật 1×2: đặt lưới ảnh 1×2, rồi với từng ô khai báo
 * chọn ô nào của ảnh sẽ được cắt cho ô đó.
 */
export default function LayoutEditor({
  templateCols,
  templateRows,
  groups,
  initial,
  onSave,
  onReset,
  onClose,
}: Props) {
  const [imgCols, setImgCols] = useState(initial?.cols ?? templateCols);
  const [imgRows, setImgRows] = useState(initial?.rows ?? templateRows);
  const [map, setMap] = useState<Record<string, string>>(() => {
    if (initial) return { ...initial.map };
    // mặc định: ô khai báo (c,r) -> ô ảnh (c,r) nếu lưới giống nhau
    const m: Record<string, string> = {};
    groups.flat().forEach(([c, r]) => (m[cellKey(c, r)] = cellKey(c, r)));
    return m;
  });
  const [error, setError] = useState("");

  const cells: TemplateCell[] = groups.flatMap((g, gi) => g.map(([c, r]) => ({ c, r, group: gi + 1 })));
  const imageCells: string[] = [];
  for (let r = 1; r <= imgRows; r++) for (let c = 1; c <= imgCols; c++) imageCells.push(cellKey(c, r));

  const changeImageSize = (field: "cols" | "rows", value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 30) return;
    const nc = field === "cols" ? value : imgCols;
    const nr = field === "rows" ? value : imgRows;
    if (field === "cols") setImgCols(value);
    else setImgRows(value);
    // ô ánh xạ ra ngoài lưới mới thì đưa về ô 1,1
    setMap((m) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) {
        const [c, r] = v.split(",").map(Number);
        next[k] = c <= nc && r <= nr ? v : "1,1";
      }
      return next;
    });
  };

  const setTarget = (templateKey: string, imageKey: string) =>
    setMap((m) => ({ ...m, [templateKey]: imageKey }));

  const save = () => {
    const missing = cells.filter(({ c, r }) => !map[cellKey(c, r)]);
    if (missing.length) return setError("Chưa chọn ô ảnh cho mọi ô khai báo");
    onSave({ cols: imgCols, rows: imgRows, map });
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog layout-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Chỉnh bố cục ảnh này</h3>
        <p className="hint">
          Khai báo gốc: {templateCols} ngang × {templateRows} dọc. Đặt lưới thật của ảnh, rồi chọn với từng ô khai báo
          là ô nào của ảnh sẽ được cắt cho ô đó.
        </p>

        <div className="fields">
          <label>
            Ô ngang của ảnh
            <input type="number" min={1} max={30} value={imgCols} onChange={(e) => changeImageSize("cols", Number(e.target.value))} />
          </label>
          <label>
            Ô dọc của ảnh
            <input type="number" min={1} max={30} value={imgRows} onChange={(e) => changeImageSize("rows", Number(e.target.value))} />
          </label>
        </div>

        <table className="admin-table cell-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Ô khai báo</th>
              <th>Nhóm</th>
              <th>Lấy từ ô của ảnh</th>
            </tr>
          </thead>
          <tbody>
            {cells.map(({ c, r, group }) => {
              const k = cellKey(c, r);
              return (
                <tr key={k}>
                  <td>{c}, {r}</td>
                  <td>Nhóm {group}</td>
                  <td>
                    <select value={map[k] ?? ""} onChange={(e) => setTarget(k, e.target.value)}>
                      <option value="" disabled>— chọn —</option>
                      {imageCells.map((ik) => (
                        <option key={ik} value={ik}>
                          ô ảnh {ik.replace(",", ", ")}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {error && <p className="message error">{error}</p>}

        <div className="actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          {initial && <button onClick={onReset}>Dùng khai báo gốc</button>}
          <button onClick={onClose}>Hủy</button>
          <button className="primary" onClick={save}>Lưu bố cục</button>
        </div>
      </div>
    </div>
  );
}
