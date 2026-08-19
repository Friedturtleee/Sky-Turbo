import type { Metadata } from "next";
import { ItemDetail } from "@/components/item-detail";

export const metadata: Metadata = { title: "Item Detail" };
export default async function ItemPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  return <ItemDetail productId={decodeURIComponent(productId)} />;
}

