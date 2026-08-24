"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { BookmarksProvider } from "./bookmarks";
import { CraftRequirementPreferencesProvider } from "./craft-requirement-preferences";
import { I18nProvider } from "./i18n";

export function AppProviders({ children }: { children: ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const content = <I18nProvider><BookmarksProvider authEnabled={clerkEnabled}>
    <CraftRequirementPreferencesProvider authEnabled={clerkEnabled}>{children}</CraftRequirementPreferencesProvider>
  </BookmarksProvider></I18nProvider>;
  return clerkEnabled ? <ClerkProvider>{content}</ClerkProvider> : content;
}
