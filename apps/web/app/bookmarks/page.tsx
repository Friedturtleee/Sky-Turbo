import type { Metadata } from "next";
import { MarketDashboard } from "@/components/market-dashboard";

export const metadata: Metadata = { title: "Bookmarked" };
export default function BookmarksPage() {
  return <><header className="page-header"><div><span className="eyebrow">Personal watchlist</span><h1>Bookmarked</h1><p>登入後透過 Clerk 與 D1 跨裝置同步；未設定登入時仍會保存在這台瀏覽器。</p></div></header><MarketDashboard bookmarksOnly /></>;
}

