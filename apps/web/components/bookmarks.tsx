"use client";

import { useAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type BookmarkContextValue = {
  bookmarks: Set<string>;
  ready: boolean;
  toggle: (productId: string) => Promise<void>;
};

const BookmarkContext = createContext<BookmarkContextValue | null>(null);
const STORAGE_KEY = "sky-turbo:bookmarks";

function readLocal(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function LocalBookmarks({ children }: { children: ReactNode }) {
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setBookmarks(readLocal());
    setReady(true);
  }, []);
  const toggle = useCallback(async (productId: string) => {
    setBookmarks((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);
  const value = useMemo(() => ({ bookmarks, ready, toggle }), [bookmarks, ready, toggle]);
  return <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>;
}

function SyncedBookmarks({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const edgeUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.replace(/\/$/, "");

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !edgeUrl) {
      setBookmarks(readLocal());
      return;
    }
    void getToken().then(async (token) => {
      const response = await fetch(`${edgeUrl}/v1/me/bookmarks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: { productIds?: string[] } };
      setBookmarks(new Set(payload.data?.productIds ?? []));
    });
  }, [edgeUrl, getToken, isLoaded, isSignedIn]);

  const toggle = useCallback(
    async (productId: string) => {
      const removing = bookmarks.has(productId);
      const next = new Set(bookmarks);
      if (removing) next.delete(productId);
      else next.add(productId);
      setBookmarks(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      if (!isSignedIn || !edgeUrl) return;
      const token = await getToken();
      const response = await fetch(`${edgeUrl}/v1/me/bookmarks/${encodeURIComponent(productId)}`, {
        method: removing ? "DELETE" : "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) setBookmarks(bookmarks);
    },
    [bookmarks, edgeUrl, getToken, isSignedIn],
  );

  const value = useMemo(() => ({ bookmarks, ready: isLoaded, toggle }), [bookmarks, isLoaded, toggle]);
  return <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>;
}

export function BookmarksProvider({ children, authEnabled }: { children: ReactNode; authEnabled: boolean }) {
  return authEnabled ? <SyncedBookmarks>{children}</SyncedBookmarks> : <LocalBookmarks>{children}</LocalBookmarks>;
}

export function useBookmarks() {
  const value = useContext(BookmarkContext);
  if (!value) throw new Error("useBookmarks must be used within BookmarksProvider");
  return value;
}

export function BookmarkButton({ productId }: { productId: string }) {
  const { bookmarks, toggle } = useBookmarks();
  const active = bookmarks.has(productId);
  return (
    <button
      className={`bookmark-button${active ? " active" : ""}`}
      type="button"
      aria-label={active ? "取消書籤" : "加入書籤"}
      aria-pressed={active}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle(productId);
      }}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

