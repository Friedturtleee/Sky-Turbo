import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/app-providers";
import { AuthControls } from "@/components/auth-controls";
import "./globals.css";
import "./shard-controls.css";

export const metadata: Metadata = {
  title: { default: "Sky Turbo", template: "%s · Sky Turbo" },
  description: "Hypixel SkyBlock Bazaar、Craft、Shard 與 NPC Flip 即時看盤器",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="zh-Hant"><body><AppProviders><div className="app-shell">
    <aside className="sidebar"><Link className="brand" href="/"><span>ST</span><div><strong>Sky Turbo</strong><small>Market Intelligence</small></div></Link>
      <nav><Link href="/"><span>01</span>Bazaar Flips</Link><Link href="/skyblock-index"><span>02</span>Skyblock Index</Link><Link href="/shards"><span>03</span>Shard Flip</Link><Link href="/crafts"><span>04</span>Craft Flip</Link><Link href="/npc-flips"><span>05</span>NPC Flip</Link><Link href="/crashing"><span>06</span>Crashing</Link><Link href="/bookmarks"><span>07</span>Bookmarked</Link></nav>
      <div className="sidebar-foot"><span className="status-dot" />Market data · 10–20s refresh<small>Not affiliated with Hypixel.</small></div>
    </aside>
    <div className="content-shell"><header className="topbar"><Link className="mobile-brand" href="/">Sky Turbo</Link><div className="topbar-note">Bazaar 稅依市長自動調整 · CPH 為估算值</div><AuthControls /></header><main>{children}</main>
      <footer>Charts by <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a> · Item textures © <a href="https://hypixel.net/" target="_blank" rel="noreferrer">Hypixel Inc.</a> · Not affiliated with or endorsed by Hypixel.</footer>
    </div>
  </div></AppProviders></body></html>;
}
