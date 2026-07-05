/**
 * GET /api/system/metrics — Prometheus exposition for the dashboard.
 *
 * The dashboard runs on the HOST, so Prometheus (in Docker) scrapes this via
 * host.docker.internal:3000 with HTTP Basic auth (see
 * infra/prometheus/prometheus.yml + the dashboard demo-auth middleware).
 */
import { metrics } from "../../../../src/server/metrics.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = await metrics.register.metrics();
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": metrics.register.contentType },
  });
}
