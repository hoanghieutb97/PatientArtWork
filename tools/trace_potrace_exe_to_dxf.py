#!/usr/bin/env python3
"""
Chọn một thư mục, trace tất cả file TIF/TIFF trong đó bằng potrace.exe và xuất DXF.

Với mỗi file:
  1. Lấy pixel đen, không trong suốt (viền trắng và nền bị bỏ qua), bỏ nhiễu nhỏ.
  2. Ghi PBM (đen = chủ thể) rồi chạy potrace.exe -b svg.
  3. Đọc đường cong (M/l/c/z) trong SVG, đổi về tọa độ pixel của ảnh gốc.
  4. Xuất DXF: mỗi đường bao là một SPLINE khép kín (Bézier bậc 3).
     Khung trang (layer FRAME) đúng kích thước ảnh gốc, các hình nằm đúng vị trí.
     Đơn vị mm: 1 px = 25.4 / DPI (ảnh không có DPI thì dùng 300).

DXF được lưu vào thư mục con "dxf" trong thư mục đã chọn, tên file giữ nguyên.

Cách dùng:
  python trace_potrace_exe_to_dxf.py                 (mở hộp thoại chọn thư mục)
  python trace_potrace_exe_to_dxf.py "D:\\anh_tif"     (không mở hộp thoại)
  python trace_potrace_exe_to_dxf.py "D:\\anh_tif" --threshold 100 --turdsize 20
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote
from pathlib import Path

import cv2
import ezdxf
import numpy as np
from ezdxf.math import Bezier4P, Vec2, bezier_to_bspline
from PIL import Image

# TIF scan thường rất lớn (hàng trăm triệu pixel): tắt giới hạn chống "decompression bomb" của Pillow
Image.MAX_IMAGE_PIXELS = None

POTRACE_DEFAULT = r"C:\Windows\potrace.exe"
TIF_SUFFIXES = {".tif", ".tiff"}

Pt = tuple[float, float]
Seg = tuple[Pt, Pt, Pt, Pt]  # Bézier bậc 3: điểm đầu, c1, c2, điểm cuối


def pick_folder() -> Path | None:
    """Mở hộp thoại chọn thư mục."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    chosen = filedialog.askdirectory(title="Chọn thư mục chứa file TIF")
    root.destroy()
    return Path(chosen) if chosen else None


def list_tifs(folder: Path) -> list[Path]:
    """Các file TIF/TIFF trong thư mục (không đệ quy), sắp theo tên."""
    files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in TIF_SUFFIXES]
    return sorted(files, key=lambda p: p.name.lower())


def load_dark_mask(path: Path, threshold: int) -> tuple[np.ndarray, float, int, int]:
    """Mask bool (True = đen, không trong suốt), mm/px, rộng px, cao px. Dùng khung đầu tiên của file."""
    im = Image.open(path)
    im.seek(0)
    width, height = im.size
    dpi = im.info.get("dpi")
    dpi_x = float(dpi[0]) if dpi and dpi[0] else 300.0

    try:
        rgba = np.array(im.convert("RGBA"))
    except (ValueError, OSError):
        # một số TIF (16-bit, khác mode) không convert trực tiếp được
        rgba = np.array(im.convert("L").convert("RGBA"))

    dark = (rgba[..., :3].max(axis=2) < threshold) & (rgba[..., 3] > 128)
    return dark, 25.4 / dpi_x, width, height


def clean_mask(mask: np.ndarray) -> np.ndarray:
    """Mở hình thái học nhỏ để bỏ chấm nhiễu li ti."""
    m = mask.astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return m > 0


def write_pbm(mask: np.ndarray, path: Path) -> None:
    """PBM: pixel đen (0) là chủ thể mà potrace sẽ trace."""
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).convert("1").save(path)


def run_potrace(exe: str, pbm: Path, svg: Path, turdsize: int, alphamax: float, opttolerance: float) -> None:
    cmd = [
        exe, "-b", "svg",
        "-t", str(turdsize),
        "-a", str(alphamax),
        "-O", str(opttolerance),
        "-o", str(svg), str(pbm),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not svg.exists():
        raise RuntimeError(f"potrace lỗi (mã {res.returncode}): {res.stderr.strip()}")


_TOKEN = re.compile(r"[MmLlCcZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def parse_svg_loops(svg_path: Path) -> list[list[Seg]]:
    """Đọc mọi <path> trong SVG của potrace, trả về các vòng Bézier ở tọa độ pixel (gốc trên trái)."""
    text = svg_path.read_text(encoding="utf-8")

    # transform của potrace: translate(tx,ty) scale(sx,sy) -> pixel = (tx + sx*x, ty + sy*y)
    tx = ty = 0.0
    sx = sy = 1.0
    g = re.search(r'transform="([^"]+)"', text)
    if g:
        t = re.search(r"translate\(\s*([-\d.eE+]+)[ ,]+([-\d.eE+]+)\s*\)", g.group(1))
        s = re.search(r"scale\(\s*([-\d.eE+]+)[ ,]+([-\d.eE+]+)\s*\)", g.group(1))
        if t:
            tx, ty = float(t.group(1)), float(t.group(2))
        if s:
            sx, sy = float(s.group(1)), float(s.group(2))

    def to_px(p: Pt) -> Pt:
        return tx + sx * p[0], ty + sy * p[1]

    loops: list[list[Seg]] = []
    for d in re.findall(r'<path[^>]*\sd="([^"]+)"', text):
        tokens = _TOKEN.findall(d)
        i = 0
        cmd: str | None = None
        cur: Pt = (0.0, 0.0)
        start: Pt = (0.0, 0.0)
        segs: list[Seg] = []

        def num() -> float:
            nonlocal i
            v = float(tokens[i])
            i += 1
            return v

        while i < len(tokens):
            tok = tokens[i]
            if tok.isalpha():
                cmd = tok
                i += 1
                if cmd in "Zz":
                    if cur != start:
                        segs.append(_line(cur, start))
                    cur = start
                    cmd = None
                    continue
            if cmd is None:
                i += 1
                continue

            if cmd in "Mm":
                x, y = num(), num()
                if cmd == "m":
                    x, y = x + cur[0], y + cur[1]
                if segs:
                    loops.append(segs)
                    segs = []
                cur = start = (x, y)
                cmd = "L" if cmd == "M" else "l"
            elif cmd in "Ll":
                x, y = num(), num()
                if cmd == "l":
                    x, y = x + cur[0], y + cur[1]
                segs.append(_line(cur, (x, y)))
                cur = (x, y)
            elif cmd in "Cc":
                x1, y1, x2, y2, x3, y3 = num(), num(), num(), num(), num(), num()
                if cmd == "c":
                    x1, y1 = x1 + cur[0], y1 + cur[1]
                    x2, y2 = x2 + cur[0], y2 + cur[1]
                    x3, y3 = x3 + cur[0], y3 + cur[1]
                segs.append((cur, (x1, y1), (x2, y2), (x3, y3)))
                cur = (x3, y3)
            else:
                i += 1  # lệnh không hỗ trợ: bỏ qua

        if segs:
            loops.append(segs)

    return [[tuple(to_px(p) for p in seg) for seg in loop] for loop in loops]  # type: ignore[misc]


def _line(a: Pt, b: Pt) -> Seg:
    """Đoạn thẳng a -> b dưới dạng Bézier bậc 3 thẳng."""
    p1 = (a[0] + (b[0] - a[0]) / 3.0, a[1] + (b[1] - a[1]) / 3.0)
    p2 = (a[0] + 2.0 * (b[0] - a[0]) / 3.0, a[1] + 2.0 * (b[1] - a[1]) / 3.0)
    return a, p1, p2, b


def write_dxf(loops: list[list[Seg]], out_path: Path, width_px: int, height_px: int, mm: float) -> int:
    doc = ezdxf.new("R2010")
    doc.units = ezdxf.units.MM
    doc.layers.add("TRACE", color=7)
    doc.layers.add("FRAME", color=8)
    msp = doc.modelspace()

    frame = [(0.0, 0.0), (width_px * mm, 0.0), (width_px * mm, height_px * mm), (0.0, height_px * mm)]
    msp.add_lwpolyline(frame, close=True, dxfattribs={"layer": "FRAME"})

    def xy(p: Pt) -> Vec2:
        # pixel (gốc trên trái) -> mm (gốc dưới trái)
        return Vec2(p[0] * mm, (height_px - p[1]) * mm)

    count = 0
    for segs in loops:
        beziers = [Bezier4P([xy(p) for p in seg]) for seg in segs]
        spline = msp.add_spline(dxfattribs={"layer": "TRACE"})
        spline.apply_construction_tool(bezier_to_bspline(beziers))
        spline.closed = True
        count += 1

    doc.saveas(out_path)
    return count


def trace_file(src: Path, out: Path, exe: str, args: argparse.Namespace) -> int:
    """Trace một file TIF và ghi DXF. Trả về số đường bao."""
    dark, mm, width_px, height_px = load_dark_mask(src, args.threshold)
    mask = clean_mask(dark)
    with tempfile.TemporaryDirectory() as tmp:
        pbm = Path(tmp) / "mask.pbm"
        svg = Path(tmp) / "trace.svg"
        write_pbm(mask, pbm)
        run_potrace(exe, pbm, svg, args.turdsize, args.alphamax, args.opttolerance)
        loops = parse_svg_loops(svg)
    return write_dxf(loops, out, width_px, height_px, mm)


def find_potrace(explicit: str | None) -> str:
    if explicit:
        return explicit
    found = shutil.which("potrace")
    if found:
        return found
    if Path(POTRACE_DEFAULT).exists():
        return POTRACE_DEFAULT
    raise FileNotFoundError("Không tìm thấy potrace.exe (thử --potrace đường_dẫn)")


def process_folder(folder: Path, args: argparse.Namespace, exe: str) -> tuple[int, int]:
    """Trace các file TIF trong thư mục. Bỏ qua file đã có DXF mới hơn (trừ khi --force)."""
    files = list_tifs(folder)
    if not files:
        print(f"Không có file TIF/TIFF nào trong: {folder}")
        return 0, 0

    out_dir = folder / "dxf"
    out_dir.mkdir(exist_ok=True)
    todo = []
    for src in files:
        out = out_dir / f"{src.stem}.dxf"
        if not args.force and out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
            continue
        todo.append((src, out))

    print(f"Thư mục: {folder}")
    print(f"Có {len(files)} file TIF, cần trace {len(todo)} file. DXF lưu vào: {out_dir}")
    ok = 0
    for i, (src, out) in enumerate(todo, 1):
        try:
            n = trace_file(src, out, exe, args)
            ok += 1
            print(f"[{i}/{len(todo)}] {src.name} -> {out.name} ({n} đường bao)")
        except Exception as err:  # một file lỗi thì bỏ qua, chạy tiếp các file sau
            print(f"[{i}/{len(todo)}] {src.name} LỖI: {err}", file=sys.stderr)
    print(f"Xong: {ok}/{len(todo)} file.")
    return ok, len(todo)


def read_folder_from_signal(signal_file: Path) -> Path | None:
    """Đọc đường dẫn thư mục từ nội dung file tín hiệu (dòng khác trống đầu tiên)."""
    raw = signal_file.read_bytes()
    text = None
    for enc in ("utf-8-sig", "utf-16", "cp1258", "cp1252"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return None
    for line in text.splitlines():
        p = line.strip().strip('"').strip("'").strip()
        if p:
            # đường dẫn có thể bị mã hóa URL (%20 = khoảng trắng): giải mã nếu có dạng %XX
            if re.search(r"%[0-9A-Fa-f]{2}", p):
                p = unquote(p)
            return Path(p)
    return None


def watch(signal_file: Path, args: argparse.Namespace, exe: str) -> int:
    """Theo dõi file tín hiệu. Mỗi lần file bị ghi đè, đọc đường dẫn thư mục trong file rồi trace các file TIF trong đó."""

    def stamp():
        try:
            st = signal_file.stat()
            return st.st_mtime_ns, st.st_size
        except FileNotFoundError:
            return None

    last = stamp()
    print(f"Đang theo dõi: {signal_file}  (Ctrl+C để dừng)")
    print(f"Trạng thái ban đầu: {'chưa có file' if last is None else 'đã có file, chờ lần ghi đè tiếp theo'}")
    try:
        while True:
            time.sleep(args.interval)
            cur = stamp()
            if cur is None or cur == last:
                continue
            # chờ file ghi xong: đến khi kích thước/mtime không đổi trong 1 giây
            while True:
                time.sleep(1.0)
                again = stamp()
                if again == cur:
                    break
                cur = again
                if cur is None:
                    break
            last = cur
            if cur is None:
                continue
            folder = read_folder_from_signal(signal_file)
            stamp_now = time.strftime('%H:%M:%S')
            if folder is None or not folder.is_dir():
                print(f"[{stamp_now}] {signal_file.name} có đường dẫn không hợp lệ hoặc không truy cập được: {folder}",
                      file=sys.stderr)
                continue
            print(f"\n[{stamp_now}] {signal_file.name} vừa được ghi đè -> trace thư mục {folder}")
            process_folder(folder, args, exe)
            print(f"[{time.strftime('%H:%M:%S')}] Tiếp tục theo dõi...")
    except KeyboardInterrupt:
        print("\nĐã dừng theo dõi.")
        return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Trace file TIF trong thư mục bằng potrace.exe ra DXF.")
    parser.add_argument("folder", nargs="?", type=Path, help="thư mục chứa file TIF (bỏ trống để chọn bằng hộp thoại)")
    parser.add_argument("--watch", type=Path, metavar="FILE",
                        help="theo dõi file tín hiệu (ví dụ \\192.168.1.240\camxoa\pyTrace.txt); "
                             "mỗi lần file bị ghi đè thì trace thư mục chứa nó")
    parser.add_argument("--interval", type=float, default=2.0,
                        help="chu kỳ kiểm tra file tín hiệu, giây (mặc định 2)")
    parser.add_argument("--force", action="store_true",
                        help="trace lại cả file đã có DXF mới hơn")
    parser.add_argument("--potrace", help=f"đường dẫn potrace.exe (mặc định: {POTRACE_DEFAULT})")
    parser.add_argument("--threshold", type=int, default=100,
                        help="ngưỡng đen: max(R,G,B) nhỏ hơn giá trị này là đen (mặc định 100)")
    parser.add_argument("--turdsize", type=int, default=20,
                        help="potrace -t: bỏ vùng đen nhỏ hơn số pixel này (mặc định 20)")
    parser.add_argument("--alphamax", type=float, default=1.0,
                        help="potrace -a: 0 = toàn đường cong, 1.33 = nhiều góc (mặc định 1.0)")
    parser.add_argument("--opttolerance", type=float, default=0.2,
                        help="potrace -O: dung sai tối ưu đường cong (mặc định 0.2)")
    args = parser.parse_args()

    exe = find_potrace(args.potrace)

    if args.watch:
        if not args.watch.parent.is_dir():
            print(f"Không truy cập được thư mục: {args.watch.parent}", file=sys.stderr)
            return 1
        return watch(args.watch, args, exe)

    folder: Path | None = args.folder or pick_folder()
    if folder is None:
        print("Chưa chọn thư mục.")
        return 0
    if not folder.is_dir():
        print(f"Không phải thư mục: {folder}", file=sys.stderr)
        return 1
    process_folder(folder, args, exe)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
