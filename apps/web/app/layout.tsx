import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AppProviders } from "@/components/app-providers";
import "./globals.css";
import "./shard-controls.css";

export const metadata: Metadata = {
  title: { default: "Sky Turbo", template: "%s · Sky Turbo" },
  description: "Hypixel SkyBlock Bazaar、Craft、Shard 與 NPC Flip 即時看盤器",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="zh-Hant" suppressHydrationWarning><body><AppProviders><AppShell>{children}</AppShell></AppProviders></body></html>;
}
