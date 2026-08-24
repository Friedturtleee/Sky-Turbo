"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AuthControls } from "./auth-controls";
import { LanguageSwitcher, useI18n } from "./i18n";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const links = [
    ["/", "01", "nav.bazaar"],
    ["/skyblock-index", "02", "nav.index"],
    ["/shards", "03", "nav.shard"],
    ["/crafts", "04", "nav.craft"],
    ["/npc-flips", "05", "nav.npc"],
    ["/crashing", "06", "nav.crashing"],
    ["/bookmarks", "07", "nav.bookmarks"],
  ] as const;
  return <div className="app-shell">
    <aside className="sidebar"><Link className="brand" href="/"><span>ST</span><div><strong>Sky Turbo</strong><small>{t("chrome.brandSubtitle")}</small></div></Link>
      <nav>{links.map(([href, order, key]) => <Link href={href} key={href}><span>{order}</span>{t(key)}</Link>)}</nav>
      <div className="sidebar-foot"><span className="status-dot" />{t("chrome.marketData")}<small>{t("chrome.notAffiliated")}</small></div>
    </aside>
    <div className="content-shell"><header className="topbar"><Link className="mobile-brand" href="/">Sky Turbo</Link><div className="topbar-note">{t("chrome.taxNote")}</div><LanguageSwitcher /><AuthControls /></header><main>{children}</main>
      <footer>{t("chrome.footer")}</footer>
    </div>
  </div>;
}
