"use client";

import { useI18n, type TranslationKey } from "./i18n";

type Page = "home" | "bookmarks" | "crashing" | "craft" | "shard" | "npc" | "index";

export function PageHeader({ page, live = false }: { page: Page; live?: boolean }) {
  const { t } = useI18n();
  const key = (part: "eyebrow" | "title" | "description") => `${page}.${part}` as TranslationKey;
  return <header className="page-header"><div><span className="eyebrow">{t(key("eyebrow"))}</span><h1>{t(key("title"))}</h1><p>{t(key("description"))}</p></div>{live ? <span className="live-pill"><i />{t("chrome.live")}</span> : null}</header>;
}
