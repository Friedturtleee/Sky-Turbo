"use client";

import { formatCraftRequirementLevel, groupCraftRequirements } from "@sky-turbo/core";
import { useMemo, useState } from "react";
import { useCraftRequirementPreferences } from "./craft-requirement-preferences";
import { useI18n } from "./i18n";

export function CraftRequirementFilter({ requirements }: { requirements: string[] }) {
  const { number, t } = useI18n();
  const {
    requirementLevels,
    canRetry,
    clear,
    ready,
    retrySync,
    saving,
    setLevel,
    storageLabel,
    syncError,
  } = useCraftRequirementPreferences();
  const [query, setQuery] = useState("");
  const scales = useMemo(() => groupCraftRequirements(requirements), [requirements]);
  const matching = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? scales.filter((scale) => scale.label.toLowerCase().includes(normalizedQuery))
      : scales;
  }, [query, scales]);
  const configuredCount = Object.keys(requirementLevels).length;

  const translatedStorageLabel = storageLabel === "已隨登入帳號同步" ? t("requirements.synced") : t("requirements.local");
  return <details className="filters craft-requirement-filter">
    <summary>{t("requirements.summary", { count: configuredCount > 0 ? t("requirements.configured", { count: number(configuredCount) }) : "" })}</summary>
    <div className="craft-requirement-panel">
      <div className="craft-requirement-heading">
        <div><strong>{t("requirements.heading")}</strong><small>{t("requirements.description")}</small></div>
        <div className="craft-requirement-sync"><span className={syncError ? "negative" : undefined}>{saving ? t("requirements.syncing") : syncError || translatedStorageLabel}</span>{syncError && canRetry ? <button className="detail-button" type="button" onClick={retrySync}>{t("requirements.retry")}</button> : null}</div>
      </div>
      <div className="craft-requirement-actions">
        <label><span>{t("requirements.search")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("requirements.searchPlaceholder")} /></label>
        <button className="button subtle" type="button" disabled={!ready || configuredCount === 0} onClick={clear}>{t("requirements.clear")}</button>
      </div>
      <div className="craft-requirement-scroll-hint"><span>{t("requirements.sliderHint")}</span><span>{t("requirements.groups", { count: number(matching.length) })}</span></div>
      <div className="craft-requirement-options" aria-busy={!ready} tabIndex={0}>
        {!ready ? <span className="craft-requirement-state"><span className="spinner" />{t("requirements.loading")}</span> : matching.map((scale) => {
          const configured = requirementLevels[scale.key];
          const current = configured ?? scale.maxLevel;
          const display = formatCraftRequirementLevel(current, scale.format);
          const maximum = formatCraftRequirementLevel(scale.maxLevel, scale.format);
          return <label className="craft-requirement-range" key={scale.key}>
            <span className="craft-requirement-range-heading"><strong>{scale.label}</strong><span>{configured === undefined ? t("requirements.unlimited", { maximum }) : `${display} / ${maximum}`}</span></span>
            <input
              type="range"
              min="0"
              max={scale.maxLevel}
              step="1"
              value={current}
              aria-label={`${scale.label} 目前等級 ${display}`}
              onChange={(event) => {
                const level = Number(event.target.value);
                setLevel(scale.key, level >= scale.maxLevel ? undefined : level);
              }}
            />
            <span className="craft-requirement-range-scale"><span>0</span><span>{maximum}</span></span>
          </label>;
        })}
        {ready && matching.length === 0 ? <span className="craft-requirement-state">{t("requirements.none")}</span> : null}
      </div>
      <p>{t("requirements.note")}</p>
    </div>
  </details>;
}
