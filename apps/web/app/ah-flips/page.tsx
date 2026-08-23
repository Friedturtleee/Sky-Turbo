import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "AH Flip" };

export default function AhFlipsPage() {
  notFound();
}
