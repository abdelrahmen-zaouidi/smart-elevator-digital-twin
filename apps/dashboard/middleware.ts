import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// HTTP Basic-Auth gate for the public demo tunnel.
//
// Rationale: ElevatorOS can issue commands to a REAL elevator through the
// server-side /api/commands safety gate, so any publicly reachable URL MUST be
// authenticated. This gate covers every page AND every /api/* route.
//
// The gate is ACTIVE only when DASHBOARD_BASIC_AUTH_PASS is set (see .env.local);
// with it unset the app is open for ordinary local development. Values are read
// at build time into the edge-middleware bundle (server-side only — never shipped
// to the browser).
//
// Works with the live SSE feed (useDitto / EventSource): once the browser caches
// the Basic credentials for the origin it auto-attaches them to every same-origin
// request, including EventSource and the REST-polling fallback.
const USER = process.env.DASHBOARD_BASIC_AUTH_USER || "demo";
const PASS = process.env.DASHBOARD_BASIC_AUTH_PASS || "";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function middleware(req: NextRequest) {
  // Fail open only when no password is configured (local dev convenience).
  if (!PASS) return NextResponse.next();

  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6)); // "user:pass"
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (safeEqual(user, USER) && safeEqual(pass, PASS)) {
        return NextResponse.next();
      }
    } catch {
      // malformed header -> treat as unauthenticated
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="ElevatorOS Demo", charset="UTF-8"',
    },
  });
}

export const config = {
  // Gate the app and APIs; skip Next.js internals, static assets, the
  // read-only Prometheus metrics endpoint, and the Auth.js endpoints (the
  // per-user sign-in flow must be reachable through the demo tunnel).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/system/metrics|api/auth).*)"],
};
