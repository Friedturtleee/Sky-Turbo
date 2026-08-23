"use client";

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
  replace: (requirements: Iterable<string>) => void;
  toggle: (requirement: string) => void;
};

const CraftRequirementPreferencesContext = createContext<CraftRequirementPreferences | null>(null);
const STORAGE_KEY = "sky-turbo:craft-excluded-requirements";

function normalizeStored(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 160));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...requirements].sort()));
  } catch {
    // Account sync remains available when browser storage is blocked.
  }
}

function LocalCraftRequirementPreferences({ children }: { children: ReactNode }) {
  const [excludedRequirements, setExcludedRequirements] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setExcludedRequirements(readLocal());
    setReady(true);
  }, []);

  const replace = useCallback((requirements: Iterable<string>) => {
    const next = new Set(requirements);
    setExcludedRequirements(next);
    writeLocal(next);
  }, []);
  const toggle = useCallback((requirement: string) => {
    setExcludedRequirements((current) => {
      const next = new Set(current);
      if (next.has(requirement)) next.delete(requirement);
      else next.add(requirement);
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
    replace,
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
  const hydratedRef = useRef(false);
  const edgeUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.replace(/\/$/, "");

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
          setSyncError("");
          hydratedRef.current = true;
          setReady(true);
        }
        return;
      }
      try {
        const token = await getToken();
        const response = await fetch(`${edgeUrl}/v1/me/preferences/craft-requirements`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`同步失敗 (${response.status})`);
        const payload = await response.json() as {
          data?: { excludedRequirements?: unknown; exists?: boolean };
        };
        const remote = normalizeStored(payload.data?.excludedRequirements);
        const next = payload.data?.exists ? remote : local;
        if (!cancelled) {
          setExcludedRequirements(next);
          writeLocal(next);
          setSyncError("");
          hydratedRef.current = true;
          setReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setExcludedRequirements(local);
          setSyncError(error instanceof Error ? error.message : "帳號同步失敗");
          hydratedRef.current = true;
          setReady(true);
        }
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [edgeUrl, getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!hydratedRef.current || !isSignedIn || !edgeUrl) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSaving(true);
      void getToken().then((token) => fetch(`${edgeUrl}/v1/me/preferences/craft-requirements`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ excludedRequirements: [...excludedRequirements].sort() }),
        signal: controller.signal,
      })).then((response) => {
        if (!response.ok) throw new Error(`同步失敗 (${response.status})`);
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
  }, [edgeUrl, excludedRequirements, getToken, isSignedIn]);

  const replace = useCallback((requirements: Iterable<string>) => {
    const next = new Set(requirements);
    setExcludedRequirements(next);
    writeLocal(next);
  }, []);
  const toggle = useCallback((requirement: string) => {
    setExcludedRequirements((current) => {
      const next = new Set(current);
      if (next.has(requirement)) next.delete(requirement);
      else next.add(requirement);
      writeLocal(next);
      return next;
    });
  }, []);
  const value = useMemo<CraftRequirementPreferences>(() => ({
    excludedRequirements,
    ready,
    saving,
    syncError,
    storageLabel: isSignedIn && edgeUrl ? "已隨登入帳號同步" : "儲存在此瀏覽器",
    replace,
    toggle,
  }), [edgeUrl, excludedRequirements, isSignedIn, ready, replace, saving, syncError, toggle]);
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
