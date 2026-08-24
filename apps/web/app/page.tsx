import { MarketDashboard } from "@/components/market-dashboard";
import { PageHeader } from "@/components/page-header";

export default function HomePage() {
  return <><PageHeader page="home" live /><MarketDashboard /></>;
}
