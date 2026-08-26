import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  // Dynamic routes are deliberately no-store unless the caller explicitly
  // opts into a short, URL-keyed shared cache for public market data.
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return NextResponse.json(
    { data, error: null },
    { ...init, headers },
  );
}

export function sharedCache(seconds: number, staleSeconds = seconds * 3): HeadersInit {
  return {
    "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${staleSeconds}`,
  };
}

export function jsonError(message: string, status = 500, details?: unknown) {
  // Upstream exceptions can contain infrastructure URLs or implementation
  // details. Keep them useful locally without exposing them in production.
  const safeDetails = process.env.NODE_ENV === "development" ? details : undefined;
  return NextResponse.json(
    { data: null, error: { message, ...(safeDetails === undefined ? {} : { details: safeDetails }) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
