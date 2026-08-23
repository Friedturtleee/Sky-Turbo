"use client";

import { normalizeCraftRequirement } from "@sky-turbo/core";
import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type CraftRequirementPreferences = {
  excludedRequirements: Set<string>;
  ready: boolean;
  saving: boolean;
  syncError: string;
  storageLabel: string;
  canRetry: boolean;
  replace: (requirements: Iterable<string>) => void;
  retrySync: () => void;
  toggle: (requirement: string) => void;
};

const CraftRequirementPreferencesContext = createContext<CraftRequirementPreferences | null>(null);
const STORAGE_KEY = "sky-turbo:craft-excluded-requirements";

function normalizeRequirement(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 160) return undefined;
  const normalized = normalizeCraftRequirement(value);
  return normalized && /^Requires:\s+.{1,150}$/.test(normalized) ? normalized : undefined;
}

function normalizeRequirements(values: Iterable<unknown>): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    const normalized = normalizeRequirement(value);
    if (normalized) result.add(normalized);
  }
  return result;
}

function normalizeStored(value: unknown): Set<string> {
  return Array.isArray(value) ? normalizeRequirements(value) : new Set();
}

function serialize(requirements: Set<string>): string {
  return JSON.stringify([...requirements].sort());
}

function readLocal(): Set<string> {
  try {
    return normalizeStored(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function writeLocal(requirements: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(requirements));
  } catch {
    // Account sync remains available when browser storage is blocked.
  }
}

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    return new Error(payload.error?.message || `同步失敗 (${response.status})`);
  } catch {
    return new Error(`同步失敗 (${response.status})`);
  }
}

function LocalCraftRequirementPreferences({ children }: { children: ReactNode }) {
  const [excludedRequirements, setExcludedRequirements] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const local = readLocal();
    setExcludedRequirements(local);
    writeLocal(local);
    setReady(true);
  }, []);

  const replace = useCallback((requirements: Iterable<string>) => {
    const next = normalizeRequirements(requirements);
    setExcludedRequirements(next);
    writeLocal(next);
  }, []);
  const toggle = useCallback((requirement: string) => {
    const normalized = normalizeRequirement(requirement);
    if (!normalized) return;
    setExcludedRequirements((current) => {
      const next = new Set(current);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      writeLocal(next);
      return next;
    });
  }, []);
  const value = useMemo<CraftRequirementPreferences>(() => ({
    excludedRequirements,
    ready,
    saving: false,
    syncError: "",
    storageLabel: "儲存在此瀏覽器",
    canRetry: false,
    replace,
    retrySync: () => undefined,
    toggle,
  }), [excludedRequirements, ready, replace, toggle]);
  return <CraftRequirementPreferencesContext.Provider value={value}>{children}</CraftRequirementPreferencesContext.Provider>;
}

function SyncedCraftRequirementPreferences({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [excludedRequirements, setExcludedRequirements] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [retryRevision, setRetryRevision] = useState(0);
  const hydratedRef = useRef(false);
  const lastSavedRef = useRef("");
  const edgeUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.replace(/\/$/, "");

  const saveRemote = useCallback(async (requirements: Set<string>, signal?: AbortSignal) => {
    if (!edgeUrl) throw new Error("缺少 NEXT_PUBLIC_EDGE_API_URL，無法同步帳號");
    const token = await getToken();
    if (!token) throw new Error("無法取得登入憑證，請重新登入");
    const response = await fetch(`${edgeUrl}/v1/me/preferences/craft-requirements`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ excludedRequirements: [...requirements].sort() }),
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw await responseError(response);
  }, [edgeUrl, getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    hydratedRef.current = false;
    setReady(false);

    const hydrate = async () => {
      const local = readLocal();
      if (!isSignedIn || !edgeUrl) {
        if (!cancelled) {
          setExcludedRequirements(local);
          setSyncError(isSignedIn ? "缺少 NEXT_PUBLIC_EDGE_API_URL，帳號同步尚未啟用" : "");
          lastSavedRef.current = serialize(local);
          hydratedRef.current = true;
          setReady(true);
        }
        return;
      }
      try {
        const token = await getToken();
        if (!token) throw new Error("無法取得登入憑證，請重新登入");
        const response = await fetch(`${edgeUrl}/v1/me/preferences/craft-requirements`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw await responseError(response);
        const payload = await response.json() as {
          data?: { excludedRequirements?: unknown; exists?: boolean };
        };
        const remote = normalizeStored(payload.data?.excludedRequirements);
        const next = payload.data?.exists ? remote : local;
        if (!cancelled) {
          setExcludedRequirements(next);
          writeLocal(next);
          setSyncError("");
          lastSavedRef.current = payload.data?.exists ? serialize(next) : "";
          hydratedRef.current = true;
          setReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setExcludedRequirements(local);
          setSyncError(error instanceof Error ? error.message : "帳號同步失敗");
          lastSavedRef.current = "";
          hydratedRef.current = true;
          setReady(true);
        }
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [edgeUrl, getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!ready || !hydratedRef.current || !isSignedIn || !edgeUrl) return;
    const serialized = serialize(excludedRequirements);
    if (serialized === lastSavedRef.current) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSaving(true);
      void saveRemote(excludedRequirements, controller.signal).then(() => {
        lastSavedRef.current = serialized;
        setSyncError("");
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setSyncError(error instanceof Error ? error.message : "帳號同步失敗");
      }).finally(() => {
        if (!controller.signal.aborted) setSaving(false);
      });
    }, 400);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [edgeUrl, excludedRequirements, isSignedIn, ready, retryRevision, saveRemote]);

  const replace = useCallback((requirements: Iterable<string>) => {
    const next = normalizeRequirements(requirements);
    setExcludedRequirements(next);
    writeLocal(next);
  }, []);
  const toggle = useCallback((requirement: string) => {
    const normalized = normalizeRequirement(requirement);
    if (!normalized) return;
    setExcludedRequirements((current) => {
      const next = new Set(current);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      writeLocal(next);
      return next;
    });
  }, []);
  const retrySync = useCallback(() => {
    lastSavedRef.current = "";
    setSyncError("");
    setRetryRevision((current) => current + 1);
  }, []);
  const value = useMemo<CraftRequirementPreferences>(() => ({
    excludedRequirements,
    ready,
    saving,
    syncError,
    storageLabel: isSignedIn && edgeUrl ? "已隨登入帳號同步" : "儲存在此瀏覽器",
    canRetry: Boolean(isSignedIn && edgeUrl),
    replace,
    retrySync,
    toggle,
  }), [edgeUrl, excludedRequirements, isSignedIn, ready, replace, retrySync, saving, syncError, toggle]);
  return <CraftRequirementPreferencesContext.Provider value={value}>{children}</CraftRequirementPreferencesContext.Provider>;
}

export function CraftRequirementPreferencesProvider({
  authEnabled,
  children,
}: {
  authEnabled: boolean;
  children: ReactNode;
}) {
  return authEnabled
    ? <SyncedCraftRequirementPreferences>{children}</SyncedCraftRequirementPreferences>
    : <LocalCraftRequirementPreferences>{children}</LocalCraftRequirementPreferences>;
}

export function useCraftRequirementPreferences() {
  const value = useContext(CraftRequirementPreferencesContext);
  if (!value) throw new Error("useCraftRequirementPreferences must be used within CraftRequirementPreferencesProvider");
  return value;
}
