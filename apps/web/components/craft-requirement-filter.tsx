"use client";

import { useMemo, useState } from "react";
import { useCraftRequirementPreferences } from "./craft-requirement-preferences";

const VISIBLE_OPTION_LIMIT = 180;

function requirementLabel(requirement: string): string {
  return requirement.replace(/^Requires:\s*/i, "");
}

export function CraftRequirementFilter({ requirements }: { requirements: string[] }) {
  const {
    excludedRequirements,
    ready,
    replace,
    saving,
    storageLabel,
    syncError,
    toggle,
  } = useCraftRequirementPreferences();
  const [query, setQuery] = useState("");
  const allRequirements = useMemo(() => [...new Set([...requirements, ...excludedRequirements])]
    .sort((left, right) => {
      const selectedDifference = Number(excludedRequirements.has(right)) - Number(excludedRequirements.has(left));
      return selectedDifference || left.localeCompare(right, "en", { numeric: true });
    }), [excludedRequirements, requirements]);
  const matching = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? allRequirements.filter((requirement) => requirement.toLowerCase().includes(normalizedQuery))
      : allRequirements;
  }, [allRequirements, query]);
  const visible = matching.slice(0, VISIBLE_OPTION_LIMIT);

  return <details className="filters craft-requirement-filter">
    <summary>配方需求{excludedRequirements.size > 0 ? ` · 已排除 ${excludedRequirements.size}` : ""}</summary>
    <div className="craft-requirement-panel">
      <div className="craft-requirement-heading">
        <div><strong>排除無法達成的配方需求</strong><small>勾選後，含有該項 Requires 的 Craft Flip 將不再顯示。</small></div>
        <span className={syncError ? "negative" : undefined}>{saving ? "同步中…" : syncError || storageLabel}</span>
      </div>
      <div className="craft-requirement-actions">
        <label><span>搜尋 Requirement</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 Chili Pepper IV、Slayer 7" /></label>
        <button className="button subtle" type="button" disabled={!ready || !query.trim() || matching.length === 0} onClick={() => replace([...excludedRequirements, ...matching])}>排除搜尋結果 ({matching.length})</button>
        <button className="button subtle" type="button" disabled={!ready || excludedRequirements.size === 0} onClick={() => replace([])}>清除全部排除</button>
      </div>
      <div className="craft-requirement-options" aria-busy={!ready}>
        {!ready ? <span className="craft-requirement-state"><span className="spinner" />正在載入帳號設定…</span> : visible.map((requirement) => <label key={requirement}>
          <input type="checkbox" checked={excludedRequirements.has(requirement)} onChange={() => toggle(requirement)} />
          <span>{requirementLabel(requirement)}</span>
        </label>)}
        {ready && matching.length === 0 ? <span className="craft-requirement-state">找不到符合的 Requirement。</span> : null}
      </div>
      {matching.length > visible.length ? <small className="craft-requirement-overflow">另有 {(matching.length - visible.length).toLocaleString("zh-TW")} 項；輸入關鍵字即可縮小清單。</small> : null}
      <p>選擇會立即保存。登入時存到帳號並跨裝置同步；未登入時保留在目前瀏覽器。市場資料重新整理或清除一般資料快取不會重置此清單。</p>
    </div>
  </details>;
}
