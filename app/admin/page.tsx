"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { downloadResponse } from "@/lib/download";
import type { ExportRecord } from "@/lib/types";

type Status = "check" | "ready" | "exported";
type Counts = { check: number; ready: number; exported: number; all: number };
type RuleRow = Counts & {
  /** số thứ tự khai báo trong config/products.json, null = chưa khai báo */
  ruleIndex: number | null;
  productType: string;
  variant: string;
  ruleName: string;
};
type Summary = { total: Counts; rows: RuleRow[] };

export default function AdminPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadHistory = async () => {
    const res = await fetch("/api/exports");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setHistory(data);
  };

  const load = async () => {
    try {
      const res = await fetch("/api/admin/summary");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSummary(data);
      await loadHistory();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Không đọc được dữ liệu");
    }
  };

  useEffect(() => {
    load();
  }, []);

  /**
   * Xuất xlsx. ruleIndex = null: tất cả; status = null: mọi trạng thái.
   * File được lưu vào máy chủ, ghi vào lịch sử, và tải về trình duyệt.
   */
  const exportFile = async (ruleIndex: number | null, status: Status | null) => {
    setBusy(true);
    setMessage("Đang xuất...");
    try {
      const params = new URLSearchParams();
      if (ruleIndex !== null) params.set("rule", String(ruleIndex));
      if (status) params.set("status", status);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/export-xlsx${qs}`);
      if (!res.ok) throw new Error((await res.json()).error);
      await downloadResponse(res, "export.xlsx");
      setMessage("Đã xuất và lưu vào lịch sử. Các mã ready trong lần xuất này chuyển sang exported.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Xuất thất bại");
    } finally {
      setBusy(false);
    }
  };

  /** Icon tải xuống: bấm để xuất đúng nhóm đó */
  const XlsButton = ({
    ruleIndex,
    status,
    count,
  }: {
    ruleIndex: number | null;
    status: Status | null;
    count: number;
  }) => (
    <button
      className="xls-btn"
      title={status ? `Xuất các mã ${status}` : "Xuất tất cả trạng thái"}
      onClick={() => exportFile(ruleIndex, status)}
      disabled={busy || ruleIndex === null || count === 0}
    >
      <DownloadIcon />
    </button>
  );

  return (
    <div className="admin">
      <div className="admin-head">
        <h1>Admin</h1>
        <p className="muted">
          <Link href="/showcase">← Showcase</Link> · <Link href="/products">Khai báo loại</Link>
        </p>
      </div>

      {!summary && <p className="muted">Đang tải...</p>}

      {summary && (
        <>
          <div className="cards">
            <Card label="Tổng" value={summary.total.all} />
            <Card label="check" value={summary.total.check} tone="check" />
            <Card label="ready" value={summary.total.ready} tone="ready" />
            <Card label="exported" value={summary.total.exported} tone="exported" />
          </div>

          <div className="actions" style={{ margin: "16px 0" }}>
            <button className="primary" onClick={() => exportFile(null, null)} disabled={busy}>
              Xuất tất cả
            </button>
            <button onClick={load} disabled={busy}>Làm mới</button>
          </div>

          <table className="admin-table">
            <thead>
              <tr>
                <th className="ready-col">ready</th>
                <th>Product Type</th>
                <th>Variant</th>
                <th>Khai báo</th>
                <th className="num">check</th>
                <th className="num">exported</th>
                <th className="num">Tổng</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">Chưa có sản phẩm nào. Hãy import file Excel ở trang Showcase.</td>
                </tr>
              )}
              {summary.rows.map((t) => (
                <tr key={`${t.ruleIndex ?? "none"}-${t.productType}-${t.variant}`}>
                  <td className="ready-col">
                    <span className="count-cell">
                      {t.ready}
                      <XlsButton ruleIndex={t.ruleIndex} status="ready" count={t.ready} />
                    </span>
                  </td>
                  <td>{t.productType}</td>
                  <td>{t.variant}</td>
                  <td>{t.ruleIndex === null ? <span className="muted">chưa khai báo</span> : t.ruleName || "—"}</td>
                  <td className="num">
                    <span className="count-cell">
                      {t.check}
                      <XlsButton ruleIndex={t.ruleIndex} status="check" count={t.check} />
                    </span>
                  </td>
                  <td className="num">
                    <span className="count-cell">
                      {t.exported}
                      <XlsButton ruleIndex={t.ruleIndex} status="exported" count={t.exported} />
                    </span>
                  </td>
                  <td className="num">
                    <span className="count-cell">
                      <strong>{t.all}</strong>
                      <XlsButton ruleIndex={t.ruleIndex} status={null} count={t.all} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ marginTop: 28 }}>Lịch sử xuất</h2>
          {history.length === 0 ? (
            <p className="muted">Chưa có lần xuất nào.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>File</th>
                  <th>Khai báo</th>
                  <th>Trạng thái</th>
                  <th className="num">Số lượng</th>
                  <th>Tải lại</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.createdAt).toLocaleString("vi-VN")}</td>
                    <td title={h.filePath}>{h.fileName}</td>
                    <td>{h.label}</td>
                    <td>{h.status}</td>
                    <td className="num">{h.count}</td>
                    <td>
                      <a className="xls-btn" href={`/api/exports/${h.id}`} title="Tải lại file này">
                        <DownloadIcon />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {message && <p className="message">{message}</p>}
    </div>
  );
}

/** Icon tải xuống: mũi tên đi xuống vào khay */
function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5v8" />
      <path d="M4.5 7.5L8 11l3.5-3.5" />
      <path d="M2.5 13.5h11" />
    </svg>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`card${tone ? ` card-${tone}` : ""}`}>
      <div className="card-value">{value}</div>
      <div className="card-label">{label}</div>
    </div>
  );
}
