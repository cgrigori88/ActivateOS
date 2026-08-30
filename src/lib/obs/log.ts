/**
 * Minimal structured, correlation-aware log (Release Gate R1-G6). One JSON line per
 * event with a timestamp and a correlation id, so a single logical operation is
 * traceable across the app and the worker without a full telemetry stack. The DB
 * lifecycle tables (invocations / outbox / receipts / recompute_requests) remain the
 * durable record; this is the cross-process breadcrumb. External error tracking
 * (Sentry-class) is a separate pre-pilot gate (G6 owns the read surface, not alerting).
 */

export interface LogFields { correlationId?: string | null; orgId?: string | null; [k: string]: unknown }

export function obsLog(event: string, fields: LogFields = {}): void {
  const line = { ts: new Date().toISOString(), event, ...fields };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}
