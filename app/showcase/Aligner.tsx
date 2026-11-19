"use client";

import type { CSSProperties } from "react";
import { cellKey, placeCells, sourceRect } from "@/lib/geometry";
import type { CellOffsets, LayoutOverride } from "@/lib/types";

type Props = {
  src: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** các ô của nhóm đang xem */
  group: [number, number][];
  offsets: CellOffsets;
  /** key ô đang được điều khiển bằng nút/phím mũi tên */
  activeKey: string;
  /** màu hiển thị từng ô: "orig" = ảnh gốc, còn lại là URL ảnh chi tiết đã tô màu */
  cellColors: Record<string, string>;
  /** URL ảnh chi tiết đã tô, theo mã màu */
  inkUrls: Record<string, string>;
  /** ô nào được in ngược (lật ngang) */
  mirrorCells: Record<string, boolean>;
  /** bố cục riêng của ảnh: ô khai báo được cắt từ ô nào của ảnh */
  override?: LayoutOverride | null;
  /** kích thước khung hiển thị (px) */
  boxW: number;
  boxH: number;
  opacity: number;
  difference: boolean;
  zoom: number;
};

/** Ảnh chiếm khoảng 90% khung, giữ tỉ lệ, không kéo méo. */
const FIT_RATIO = 0.9;

export default function Aligner({
  src,
  width,
  height,
  cols,
  rows,
  group,
  offsets,
  activeKey,
  cellColors,
  inkUrls,
  mirrorCells,
  override,
  boxW,
  boxH,
  opacity,
  difference,
  zoom,
}: Props) {
  const rects = group.map(([c, r]) => sourceRect(width, height, cols, rows, c, r, override));
  const offs = group.map(([c, r]) => offsets[cellKey(c, r)] ?? { dx: 0, dy: 0 });
  const layout = placeCells(rects, offs);

  // Tỉ lệ cố định theo bố cục gốc (không có offset) để ảnh không đổi cỡ khi nudge
  const zeroOffs = group.map(() => ({ dx: 0, dy: 0 }));
  const base = placeCells(rects, zeroOffs);
  const fit = Math.min(boxW / base.canvasW, boxH / base.canvasH) * FIT_RATIO;
  const scale = fit > 0 ? fit * zoom : zoom;
  const px = (v: number) => v * scale;

  return (
    <div
      className="aligner"
      style={{
        position: "relative",
        margin: "auto",
        width: px(layout.canvasW),
        height: px(layout.canvasH),
        background: "#000000",
      }}
    >
      {group.map(([c, r], i) => {
        const rc = rects[i];
        const key = cellKey(c, r);
        const isActive = key === activeKey;
        const first = i === 0;
        const color = cellColors[key] ?? "orig";
        const cellSrc = color === "orig" ? src : inkUrls[color] ?? src;

        const cellStyle: CSSProperties = {
          position: "absolute",
          left: px(layout.placements[i].left),
          top: px(layout.placements[i].top),
          width: px(rc.w),
          height: px(rc.h),
          overflow: "hidden",
          opacity: first ? 1 : difference ? 1 : opacity,
          mixBlendMode: !first && difference ? "difference" : "normal",
          outline: isActive ? "2px solid #dc2626" : "none",
          outlineOffset: isActive ? -2 : 0,
          // in ngược: lật ngang nội dung quanh tâm ô (vị trí ô không đổi)
          transform: mirrorCells[key] ? "scaleX(-1)" : undefined,
        };
        return (
          <div key={key} style={cellStyle}>
            <img
              src={cellSrc}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: -px(rc.x),
                top: -px(rc.y),
                width: px(width),
                height: px(height),
                maxWidth: "none",
                pointerEvents: "none",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
