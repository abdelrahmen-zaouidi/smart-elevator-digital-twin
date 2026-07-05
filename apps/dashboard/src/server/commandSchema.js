/**
 * Transport-level input schema for POST /api/commands (zod).
 *
 * This is hygiene IN FRONT of the deterministic safety gate — it rejects
 * malformed envelopes early with a uniform 400. It is NOT a safety control:
 * the gate in packages/shared/commandSafetyGate.js remains the sole authority
 * over command admission. Keep this permissive about domain values (floor
 * ranges, cooldowns, twin freshness) — those are the gate's job.
 */
import { z } from "zod";

export const commandInputSchema = z
  .object({
    command: z.string().min(1).max(64),
    reason: z.union([z.string(), z.array(z.string())]).optional(),
    target_floor: z.number().int().optional(),
    thing_id: z.string().min(1).optional(),
    correlation_id: z.string().optional(),
    human_approved: z.boolean().optional(),
    confirmation: z.boolean().optional(),
    fan_state: z.union([z.string(), z.boolean(), z.number()]).optional(),
    fan_mode: z.string().optional(),
    mode: z.string().optional(),
    policy_id: z.string().optional(),
    dispatch_params: z.record(z.string(), z.unknown()).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    incident_id: z.union([z.string(), z.number()]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  // Extra keys are allowed (the gate ignores unknowns); we only enforce the
  // shape of the fields we understand.
  .passthrough();

/** Flatten a ZodError into { field: message } for the error envelope details. */
export function zodDetails(error) {
  const out = {};
  for (const issue of error.issues) {
    out[issue.path.join(".") || "_"] = issue.message;
  }
  return out;
}
