"use client";

import { useI18n } from "./i18n";

export function RefreshButton({
  onRefresh,
  refreshing = false,
}: {
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const { t } = useI18n();
  return <button
    aria-label={t("common.refreshAria")}
    className="button subtle refresh-button"
    disabled={refreshing}
    onClick={onRefresh}
    type="button"
  ><span aria-hidden="true">↻</span>{refreshing ? t("common.refreshing") : t("common.refresh")}</button>;
}
