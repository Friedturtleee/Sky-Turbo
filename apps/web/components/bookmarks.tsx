"use client";

import { useAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

function writeLocal(bookmarks: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...bookmarks]));
  } catch {
    // Remote sync can still succeed when browser storage is unavailable.
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
      writeLocal(next);
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
  const bookmarksRef = useRef(bookmarks);
  const mutationVersionRef = useRef(0);

  const replaceBookmarks = useCallback((next: Set<string>) => {
    bookmarksRef.current = next;
    setBookmarks(next);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    if (!isSignedIn || !edgeUrl) {
      replaceBookmarks(readLocal());
      return () => { cancelled = true; };
    }
    const hydrationVersion = mutationVersionRef.current;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const response = await fetch(`${edgeUrl}/v1/me/bookmarks`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { data?: { productIds?: string[] } };
        // Do not let a slow initial fetch overwrite an optimistic toggle.
        if (!cancelled && mutationVersionRef.current === hydrationVersion) {
          replaceBookmarks(new Set(payload.data?.productIds ?? []));
        }
      } catch {
        // Keep the local optimistic state when account sync is temporarily unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, [edgeUrl, getToken, isLoaded, isSignedIn, replaceBookmarks]);

  const toggle = useCallback(
    async (productId: string) => {
      const previous = bookmarksRef.current;
      const removing = previous.has(productId);
      const next = new Set(previous);
      if (removing) next.delete(productId);
      else next.add(productId);
      const mutationVersion = ++mutationVersionRef.current;
      replaceBookmarks(next);
      writeLocal(next);
      if (!isSignedIn || !edgeUrl) return;
      try {
        const token = await getToken();
        if (!token) throw new Error("Missing Clerk token");
        const response = await fetch(`${edgeUrl}/v1/me/bookmarks/${encodeURIComponent(productId)}`, {
          method: removing ? "DELETE" : "PUT",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Bookmark sync failed (${response.status})`);
      } catch {
        // Revert only this mutation, and only if a newer toggle has not superseded it.
        if (mutationVersionRef.current !== mutationVersion) return;
        const reverted = new Set(bookmarksRef.current);
        if (removing) reverted.add(productId);
        else reverted.delete(productId);
        replaceBookmarks(reverted);
        writeLocal(reverted);
      }
    },
    [edgeUrl, getToken, isSignedIn, replaceBookmarks],
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
