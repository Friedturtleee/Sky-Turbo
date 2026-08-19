import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    { data, error: null },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" }, ...init },
  );
}

export function jsonError(message: string, status = 500, details?: unknown) {
  return NextResponse.json(
    { data: null, error: { message, details } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

