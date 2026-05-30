import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DITTO_URL = stripTrailingSlash(
  process.env.DITTO_URL ||
    process.env.DITTO_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_DITTO_URL ||
    "http://localhost:8080",
);
const DITTO_USER =
  process.env.DITTO_USER ||
  process.env.NEXT_PUBLIC_DITTO_USERNAME ||
  "ditto";
const DITTO_PASSWORD =
  process.env.DITTO_PASSWORD ||
  process.env.NEXT_PUBLIC_DITTO_PASSWORD ||
  "ditto";
const DITTO_PROXY_TIMEOUT_MS = Number.parseInt(
  process.env.DITTO_PROXY_TIMEOUT_MS || "8000",
  10,
);
const DITTO_SSE_CONNECT_TIMEOUT_MS = Number.parseInt(
  process.env.DITTO_SSE_CONNECT_TIMEOUT_MS || "10000",
  10,
);

const authHeader = `Basic ${Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString("base64")}`;

function buildProxyHeaders(request: NextRequest) {
  const headers = new Headers();
  headers.set("Authorization", authHeader);

  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }

  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("accept", accept);
  }

  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId) {
    headers.set("last-event-id", lastEventId);
  }

  return headers;
}

function buildResponseHeaders(upstream: Response, isSseRequest: boolean) {
  const headers = new Headers();

  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  if (isSseRequest) {
    headers.set(
      "content-type",
      upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
    );
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("connection", "keep-alive");
    headers.set("x-accel-buffering", "no");
  }

  return headers;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown Ditto proxy error");
}

function getProxyErrorStatus(error: unknown) {
  const message = getErrorMessage(error);
  if (/abort|timeout/i.test(message)) return 504;
  if (/ECONNRESET|ECONNREFUSED|fetch failed|socket|terminated/i.test(message)) return 503;
  return 502;
}

async function forwardToDitto(
  request: NextRequest,
  paramsPromise: Promise<{ path: string[] }>,
) {
  const params = await paramsPromise;
  const segments = params?.path || [];
  const path = `/${segments.join("/")}`;
  const targetUrl = `${DITTO_URL}${path}${request.nextUrl.search}`;
  const isSseRequest = (request.headers.get("accept") || "").includes("text/event-stream");
  const controller = new AbortController();
  const timeoutMs = isSseRequest ? DITTO_SSE_CONNECT_TIMEOUT_MS : DITTO_PROXY_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: buildProxyHeaders(request),
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.text(),
      cache: "no-store",
      signal: controller.signal,
    });

    // For SSE the timeout was a connect-only guard. Once headers arrive the
    // stream must run indefinitely, so cancel the abort timer now.
    if (isSseRequest) clearTimeout(timeout);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: buildResponseHeaders(upstream, isSseRequest),
    });
  } catch (error) {
    const status = getProxyErrorStatus(error);
    const message = getErrorMessage(error);
    console.warn("[DittoProxy] upstream request failed", {
      method: request.method,
      path,
      upstream: DITTO_URL,
      status,
      message,
    });

    return NextResponse.json(
      {
        error: "ditto_upstream_unavailable",
        message,
        upstream: DITTO_URL,
        path,
      },
      { status },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return forwardToDitto(request, context.params);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return forwardToDitto(request, context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return forwardToDitto(request, context.params);
}
