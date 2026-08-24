import type { Metadata } from "next";
import { MarketDashboard } from "@/components/market-dashboard";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Bookmarked" };
export default function BookmarksPage() {
  return <><PageHeader page="bookmarks" /><MarketDashboard bookmarksOnly /></>;
}
