"use client";

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export function AuthControls() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <span className="auth-disabled" title="設定 Clerk 金鑰後啟用跨裝置同步">本機模式</span>;
  }
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="button subtle" type="button">登入同步</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}

