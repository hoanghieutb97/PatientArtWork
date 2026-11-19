"use client";

import type { CellInfo } from "@/lib/types";

type Props = {
  cols: number;
  rows: number;
  groups: [number, number][][];
  groupIndex: number;
  activeKey: string;
  cells?: Record<string, CellInfo>;
  onSelect: (key: string, groupIndex: number) => void;
};

const hue = (n: number) => `hsl(${(n * 67) % 360} 70% 82%)`;

/** Sơ đồ lưới của sản phẩm: nhóm đang chọn nổi bật, các nhóm khác mờ đi. */
export default function CellMap({ cols, rows, groups, groupIndex, activeKey, cells, onSelect }: Props) {
  const owner: Record<string, number> = {};
  groups.forEach((g, gi) => g.forEach(([c, r]) => (owner[`${c},${r}`] = gi)));

  return (
    <div className="cellmap" style={{ gridTemplateColumns: `repeat(${cols}, 72px)` }}>
      {Array.from({ length: rows }, (_, ri) => ri + 1).flatMap((r) =>
        Array.from({ length: cols }, (_, ci) => ci + 1).map((c) => {
          const k = `${c},${r}`;
          const gi = owner[k];
          const inGroup = gi !== undefined;
          const isGroup = gi === groupIndex;
          const isActive = k === activeKey;
          const info = cells?.[k];
          const bg = !inGroup ? "#e7e5e4" : info?.color ?? hue(gi);
          const classes = [
            "cm-cell",
            inGroup ? "" : "cm-out",
            isGroup ? "cm-group" : inGroup ? "cm-dim" : "",
            isActive ? "cm-active" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={k}
              className={classes}
              style={{ background: bg }}
              disabled={!inGroup}
              onClick={() => inGroup && onSelect(k, gi)}
              title={inGroup ? `Nhóm ${gi + 1}, ô (${c}, ${r})` : `ô (${c}, ${r}) không thuộc nhóm nào`}
            >
              {info?.name || `${c}, ${r}`}
            </button>
          );
        }),
      )}
    </div>
  );
}
