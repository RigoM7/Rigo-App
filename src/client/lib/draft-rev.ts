/**
 * Every save re-reads the record from the phone's storage. A read can finish after the driver typed
 * more, so a stored copy with an older revision never replaces what is on screen; an equal or newer
 * one does (sent, accepted, or changed in another tab), and so does a deletion.
 */
export function newerDraft<T extends { rev?: number }>(current: T | null, stored: T | null): T | null {
  if (!stored) return null;
  if (current && (stored.rev ?? 0) < (current.rev ?? 0)) return current;
  return stored;
}
