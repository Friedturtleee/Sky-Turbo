"use client";

import { parseCraftRequirement } from "@sky-turbo/core";
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

export type CraftRequirementLevels = Record<string, number>;

type CraftRequirementPreferences = {
  requirementLevels: CraftRequirementLevels;
  ready: boolean;
  saving: boolean;
  syncError: string;
  storageLabel: string;
  canRetry: boolean;
  clear: () => void;
  retrySync: () => void;
  setLevel: (key: string, level: number | undefined) => void;
};

const CraftRequirementPreferencesContext = createContext<CraftRequirementPreferences | null>(null);
const STORAGE_KEY = "sky-turbo:craft-requirement-levels";
const LEGACY_STORAGE_KEY = "sky-turbo:craft-excluded-requirements";

function normalizeLevels(value: unknown): CraftRequirementLevels {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: CraftRequirementLevels = {};
  for (const [key, level] of Object.entries(value)) {
    const cleanKey = key.replace(/\s+/g, " ").trim();
    if (!cleanKey || cleanKey.length > 100 || !Number.isFinite(level)) continue;
    normalized[cleanKey] = Math.max(0, Math.min(1_000, Math.floor(level as number)));
  }
  return normalized;
}

function migrateLegacyRequirements(value: unknown): CraftRequirementLevels {
  if (!Array.isArray(value)) return {};
  const levels: CraftRequirementLevels = {};
  for (const requirement of value) {
    if (typeof requirement !== "string") continue;
    const parsed = parseCraftRequirement(requirement);
    if (!parsed) continue;
    const maximumAllowed = Math.max(0, parsed.level - 1);
    levels[parsed.key] = Math.min(levels[parsed.key] ?? maximumAllowed, maximumAllowed);
  }
  return levels;
}

function stableLevels(levels: CraftRequirementLevels): CraftRequirementLevels {
  return Object.fromEntries(Object.entries(normalizeLevels(levels)).sort(([left], [right]) => left.localeCompare(right)));
}

function serialize(levels: CraftRequirementLevels): string {
  return JSON.stringify(stableLevels(levels));
}

function readLocal(): CraftRequirementLevels {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== null) return normalizeLevels(JSON.parse(current));
    return migrateLegacyRequirements(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "[]"));
  } catch {
    return {};
  }
}

function writeLocal(levels: CraftRequirementLevels) {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(levels));
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

function useLevelActions(setRequirementLevels: React.Dispatch<React.SetStateAction<CraftRequirementLevels>>) {
  const setLevel = useCallback((key: string, level: number | undefined) => {
    setRequirementLevels((current) => {
      const next = { ...current };
      if (level === undefined) delete next[key];
      else next[key] = Math.max(0, Math.min(1_000, Math.floor(level)));
      writeLocal(next);
      return next;
    });
  }, [setRequirementLevels]);
  const clear = useCallback(() => {
    setRequirementLevels({});
    writeLocal({});
  }, [setRequirementLevels]);
  return { clear, setLevel };
}

function LocalCraftRequirementPreferences({ children }: { children: ReactNode }) {
  const [requirementLevels, setRequirementLevels] = useState<CraftRequirementLevels>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const local = readLocal();
    setRequirementLevels(local);
    writeLocal(local);
    setReady(true);
  }, []);
  const { clear, setLevel } = useLevelActions(setRequirementLevels);
  const value = useMemo<CraftRequirementPreferences>(() => ({
    requirementLevels,
    ready,
    saving: false,
    syncError: "",
    storageLabel: "儲存在此瀏覽器",
    canRetry: false,
    clear,
    retrySync: () => undefined,
    setLevel,
  }), [clear, ready, requirementLevels, setLevel]);
  return <CraftRequirementPreferencesContext.Provider value={value}>{children}</CraftRequirementPreferencesContext.Provider>;
}

function SyncedCraftRequirementPreferences({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [requirementLevels, setRequirementLevels] = useState<CraftRequirementLevels>({});
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [retryRevision, setRetryRevision] = useState(0);
  const hydratedRef = useRef(false);
  const lastSavedRef = useRef("");
  const edgeUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.replace(/\/$/, "");

  const saveRemote = useCallback(async (levels: CraftRequirementLevels, signal?: AbortSignal) => {
    if (!edgeUrl) throw new Error("缺少 NEXT_PUBLIC_EDGE_API_URL，無法同步帳號");
    const token = await getToken();
    if (!token) throw new Error("無法取得登入憑證，請重新登入");
    const response = await fetch(`${edgeUrl}/v1/me/preferences/craft-requirements`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requirementLevels: stableLevels(levels) }),
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
          setRequirementLevels(local);
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
          data?: {
            preferenceVersion?: unknown;
            requirementLevels?: unknown;
            legacyExcludedRequirements?: unknown;
            excludedRequirements?: unknown;
            exists?: boolean;
          };
        };
        const needsFormatUpgrade = payload.data?.preferenceVersion === 1;
        const legacy = needsFormatUpgrade
          ? payload.data?.legacyExcludedRequirements ?? payload.data?.excludedRequirements
          : undefined;
        const remote = needsFormatUpgrade
          ? migrateLegacyRequirements(legacy)
          : normalizeLevels(payload.data?.requirementLevels);
        const next = payload.data?.exists ? remote : local;
        if (!cancelled) {
          setRequirementLevels(next);
          writeLocal(next);
          setSyncError("");
          lastSavedRef.current = payload.data?.exists && !needsFormatUpgrade ? serialize(next) : "";
          hydratedRef.current = true;
          setReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setRequirementLevels(local);
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
    const serialized = serialize(requirementLevels);
    if (serialized === lastSavedRef.current) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSaving(true);
      void saveRemote(requirementLevels, controller.signal).then(() => {
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
  }, [edgeUrl, isSignedIn, ready, requirementLevels, retryRevision, saveRemote]);

  const { clear, setLevel } = useLevelActions(setRequirementLevels);
  const retrySync = useCallback(() => {
    lastSavedRef.current = "";
    setSyncError("");
    setRetryRevision((current) => current + 1);
  }, []);
  const value = useMemo<CraftRequirementPreferences>(() => ({
    requirementLevels,
    ready,
    saving,
    syncError,
    storageLabel: isSignedIn && edgeUrl ? "已隨登入帳號同步" : "儲存在此瀏覽器",
    canRetry: Boolean(isSignedIn && edgeUrl),
    clear,
    retrySync,
    setLevel,
  }), [clear, edgeUrl, isSignedIn, ready, requirementLevels, retrySync, saving, setLevel, syncError]);
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
