"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { BookmarksProvider } from "./bookmarks";
import { CraftRequirementPreferencesProvider } from "./craft-requirement-preferences";

export function AppProviders({ children }: { children: ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const content = <BookmarksProvider authEnabled={clerkEnabled}>
    <CraftRequirementPreferencesProvider authEnabled={clerkEnabled}>{children}</CraftRequirementPreferencesProvider>
  </BookmarksProvider>;
  return clerkEnabled ? <ClerkProvider>{content}</ClerkProvider> : content;
}
