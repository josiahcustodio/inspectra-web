import { supabase } from "./supabase";

// [REF: AUDIT_EVENTS]
// Portal actions that never write a table — signing in, exporting, generating
// a report — go to the audit trail through log_event()
// (migration/sql/12_audit_events.sql), which stamps the caller from the
// session. Fire-and-forget: the trail must never block or fail the action it
// records, so a failure is logged to the console and nothing else.
export type AuditEventKind = "SIGN_IN" | "EXPORT" | "REPORT";

export function logEvent(kind: AuditEventKind, label: string): void {
  void supabase.rpc("log_event", { kind, label }).then(({ error }) => {
    if (error) console.warn(`audit ${kind} not recorded:`, error.message);
  });
}
