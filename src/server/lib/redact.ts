import { can, type CompanyCtx } from '../http/context.js';
import { fieldSensitivity, type FieldDef } from '../../shared/workspace.js';

// Contact details and money are removed on the server for roles that may not see them; screens
// never just hide them (CLAUDE.md, rules that never bend).

export const seesContact = (cc: CompanyCtx) => can(cc, 'customers.contact');
export const seesMoney = (cc: CompanyCtx) => can(cc, 'money.view');

/** Custom field values without the contact or money fields this person may not see. */
export function redactValues(cc: CompanyCtx, defs: FieldDef[], values: Record<string, unknown> | null | undefined) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    const def = defs.find((f) => f.key === k);
    if (!def) continue;
    const s = fieldSensitivity(def);
    if (s === 'contact' && !seesContact(cc)) continue;
    if (s === 'money' && !seesMoney(cc)) continue;
    out[k] = v;
  }
  return out;
}

/** Field definitions a person may fill or see (worker roles: only those marked for workers). */
export function visibleDefs(cc: CompanyCtx, defs: FieldDef[], kind: 'work' | 'customer' | 'equipment') {
  return defs.filter((f) => {
    const s = fieldSensitivity(f);
    if (s === 'contact' && !seesContact(cc)) return false;
    if (s === 'money' && !seesMoney(cc)) return false;
    return !(kind === 'work' && cc.roleApp === 'worker' && !f.forWorkers);
  });
}

/** Keeps stored values a person couldn't see when they save a form without them. */
export function mergeHidden(cc: CompanyCtx, defs: FieldDef[], stored: Record<string, unknown>, incoming: Record<string, unknown>, kind: 'work' | 'customer' | 'equipment') {
  const visible = new Set(visibleDefs(cc, defs, kind).map((f) => f.key));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored ?? {})) if (!visible.has(k)) out[k] = v;
  for (const [k, v] of Object.entries(incoming ?? {})) if (visible.has(k)) out[k] = v;
  return out;
}
