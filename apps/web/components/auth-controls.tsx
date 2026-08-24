"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useI18n } from "./i18n";

export function AuthControls() {
  const { t } = useI18n();
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <span className="auth-disabled" title={t("auth.localTitle")}>{t("auth.local")}</span>;
  }
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="button subtle" type="button">{t("auth.signIn")}</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
