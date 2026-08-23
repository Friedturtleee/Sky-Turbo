"use client";

import { formatCraftRequirementLevel, groupCraftRequirements } from "@sky-turbo/core";
import { useMemo, useState } from "react";
import { useCraftRequirementPreferences } from "./craft-requirement-preferences";

export function CraftRequirementFilter({ requirements }: { requirements: string[] }) {
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

  return <details className="filters craft-requirement-filter">
    <summary>配方需求進度{configuredCount > 0 ? ` · 已設定 ${configuredCount}` : ""}</summary>
    <div className="craft-requirement-panel">
      <div className="craft-requirement-heading">
        <div><strong>用拉桿設定帳號目前進度</strong><small>需求高於拉桿等級的 Craft Flip 會自動隱藏；拉到最右側代表此分類不限制。</small></div>
        <div className="craft-requirement-sync"><span className={syncError ? "negative" : undefined}>{saving ? "同步中…" : syncError || storageLabel}</span>{syncError && canRetry ? <button className="detail-button" type="button" onClick={retrySync}>重新同步</button> : null}</div>
      </div>
      <div className="craft-requirement-actions">
        <label><span>搜尋 Requirement 分類</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 Chili Pepper、Spider Slayer" /></label>
        <button className="button subtle" type="button" disabled={!ready || configuredCount === 0} onClick={clear}>全部恢復不限制</button>
      </div>
      <div className="craft-requirement-scroll-hint"><span>每一列都是等級拉桿</span><span>{matching.length.toLocaleString("zh-TW")} 組</span></div>
      <div className="craft-requirement-options" aria-busy={!ready} tabIndex={0}>
        {!ready ? <span className="craft-requirement-state"><span className="spinner" />正在載入帳號設定…</span> : matching.map((scale) => {
          const configured = requirementLevels[scale.key];
          const current = configured ?? scale.maxLevel;
          const display = formatCraftRequirementLevel(current, scale.format);
          const maximum = formatCraftRequirementLevel(scale.maxLevel, scale.format);
          return <label className="craft-requirement-range" key={scale.key}>
            <span className="craft-requirement-range-heading"><strong>{scale.label}</strong><span>{configured === undefined ? `不限制（${maximum}）` : `${display} / ${maximum}`}</span></span>
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
        {ready && matching.length === 0 ? <span className="craft-requirement-state">找不到符合的 Requirement 分類。</span> : null}
      </div>
      <p>拉桿設定會立即保存。登入時同步到帳號並跨裝置使用；未登入時保留在目前瀏覽器。舊版逐項排除設定會自動轉換成等級上限。</p>
    </div>
  </details>;
}
