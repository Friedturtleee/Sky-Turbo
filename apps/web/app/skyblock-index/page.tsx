import { SkyblockIndexDashboard } from "@/components/skyblock-index-dashboard";

export default function SkyblockIndexPage() {
  return <><header className="page-header"><div><span className="eyebrow">Bazaar market benchmark</span><h1>Skyblock Index</h1><p>用流動性加權的籃子追蹤 Hypixel SkyBlock Bazaar 的整體價格變化。</p></div><span className="live-pill"><i />LIVE</span></header><SkyblockIndexDashboard /></>;
}
