import { MarketDashboard } from "@/components/market-dashboard";

export default function HomePage() {
  return <><header className="page-header"><div><span className="eyebrow">Live Bazaar</span><h1>Flips Menu</h1><p>依稅後利潤、流動性與近期行情找出值得執行的 Bazaar 掛單。</p></div><span className="live-pill"><i />LIVE</span></header><MarketDashboard /></>;
}

