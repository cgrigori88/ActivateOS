/**
 * Pilot Operational Readiness OR-3 — the canonical error/alert reporting interface.
 *
 * Core application code depends on THIS interface, never on a specific provider
 * (Sentry etc.). A provider is a `Reporter` selected by env at process start; when
 * none is configured the integration fails safe to a no-op and introduces NO runtime
 * dependency on an external service.
 *
 * Safety by construction: a `TelemetryEvent` carries only ids, typed metadata, and a
 * SHORT non-confidential `message` — there is deliberately NO free-form payload/data
 * field, so raw customer data, confidential facts, confidential route reasons,
 * credentials/tokens, or cross-tenant content cannot ride along. `report()` is wrapped
 * so telemetry can never throw into the request/execution path.
 */

export type TelemetryKind =
  | "dispatch_skill"            // a governed-action dispatch decision (reject/fail)
  | "governed_action"          // a governed action invocation lifecycle failure
  | "outbox_execution"         // external-action executor failure/compensation
  | "provider_receipt"         // provider delivery/receipt failure
  | "recompute"                // recompute request failure
  | "disclosure_policy_failure"// a disclosure/policy denial worth surfacing
  | "tenant_isolation_failure" // an attempted cross-tenant access (defense-in-depth signal)
  | "federation_failure"       // a federation-layer failure
  | "worker_job_failure"       // a background worker/job failure
  | "dead_letter"              // poisoned/dead-lettered work
  | "recovery_failure";        // a recovery/restore/reconcile failure

export type Severity = "info" | "warning" | "error" | "critical";

export interface TelemetryEvent {
  kind: TelemetryKind;
  severity: Severity;
  /** A short, safe summary — codes/status only, NEVER payload or confidential text. */
  message: string;
  correlationId?: string | null;
  requestId?: string | null;
  orgId?: string | null;
  pursuitId?: string | null;
  actionInvocationId?: string | null;
  recomputeRequestId?: string | null;
  provider?: string | null;
  effectClass?: string | null;
  retryCount?: number | null;
  environment?: string | null;
  timestamp?: string;
}

export interface Reporter {
  readonly name: string;
  report(e: TelemetryEvent): void | Promise<void>;
}

/** No-op reporter — the fail-safe default when nothing is configured. */
export class NullReporter implements Reporter {
  readonly name = "null";
  report(): void { /* intentionally nothing */ }
}

/** Structured stdout reporter (safe everywhere; the local default when telemetry is on). */
export class ConsoleReporter implements Reporter {
  readonly name = "console";
  report(e: TelemetryEvent): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ telemetry: true, ts: e.timestamp ?? new Date().toISOString(), ...e }));
  }
}

/** In-memory sink for rehearsals/tests — never used in production. */
export class TestSinkReporter implements Reporter {
  readonly name = "test-sink";
  events: TelemetryEvent[] = [];
  report(e: TelemetryEvent): void { this.events.push({ ...e, timestamp: e.timestamp ?? new Date().toISOString() }); }
}

// A Sentry (or any SaaS) adapter would implement `Reporter` in its own module and be
// selected below by env — the core never imports it. Kept out of core to avoid a
// dependency when unused. See docs/OPERATIONS.md → Observability.

let active: Reporter | null = null;

/** Select the reporter from env. Fail-safe: unknown/unset ⇒ NullReporter (no-op). */
export function getReporter(): Reporter {
  if (active) return active;
  const sink = (process.env.TELEMETRY_SINK ?? "").trim().toLowerCase();
  active = sink === "console" ? new ConsoleReporter() : new NullReporter();
  return active;
}

/** Test/wiring hook — inject a reporter (e.g. the test sink). Pass null to reset. */
export function setReporter(r: Reporter | null): void { active = r; }

/**
 * Report a telemetry event. NEVER throws — a telemetry failure must not affect the
 * request or execution path. Stamps environment + timestamp when absent.
 */
export function reportEvent(e: TelemetryEvent): void {
  try {
    getReporter().report({ ...e, environment: e.environment ?? process.env.APP_ENV ?? "unknown", timestamp: e.timestamp ?? new Date().toISOString() });
  } catch { /* swallow — telemetry is best-effort */ }
}
