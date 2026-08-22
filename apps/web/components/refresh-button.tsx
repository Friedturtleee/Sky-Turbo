"use client";

export function RefreshButton({
  onRefresh,
  refreshing = false,
}: {
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  return <button
    aria-label="重新抓取最新資料"
    className="button subtle refresh-button"
    disabled={refreshing}
    onClick={onRefresh}
    type="button"
  ><span aria-hidden="true">↻</span>重新整理</button>;
}
