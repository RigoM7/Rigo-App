// What a message to the assistant is asking for (R15-M1). Rule-based, not AI: only text that
// describes a trigger and an action becomes a workflow proposal; a question never does.

const QUESTION_START = /^\s*(when|what|which|who|whose|where|why|how|is|are|can|could|do|does|did|will|would|should|has|have)\b/;
const WHEN_QUESTION = /^\s*when\s+(is|are|was|were|will|would|does|do|did|can|could|should|has|have)\b|^\s*when'?s\b/;
const TRIGGER_WORDS = /\b(when(ever)?|every time|each time|after|once)\b/;
const ACTION_WORDS = /\b(prepare|create|make|send|email|text|notify|tell|alert|let .{1,30} know|invoice|bill|issue|approve|ask|draft|follow[- ]?up|reschedule)\b/;

/** "When a job is completed, prepare an invoice…" — yes. "When is Grace's next visit?" — no. */
export function isAutomationRequest(text: string) {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\b(set up|create|make|build|add|propose)\b.{0,20}\b(workflow|automation)\b/.test(t)) return true;
  if (t.endsWith('?') || WHEN_QUESTION.test(t)) return false;
  if (QUESTION_START.test(t) && !/^\s*(when(ever)?|every time|each time|after|once)\b/.test(t)) return false;
  return TRIGGER_WORDS.test(t) && ACTION_WORDS.test(t) && /,|\bthen\b|\b(prepare|send|email|notify|tell|create|draft|issue)\b/.test(t);
}

export type Intent =
  | { kind: 'proposal' }
  | { kind: 'customer'; name: string; wants: 'next' | 'owes' | 'both' }
  | { kind: 'driversFree'; day: 'today' | 'tomorrow'; hour: number; minute: number }
  | { kind: 'price'; item: string }
  | { kind: 'whyCantApprove' }
  | { kind: 'cantYet'; what: 'text' | 'statement' | 'route' | 'payment' }
  | { kind: 'attention' } | { kind: 'held' } | { kind: 'today' } | { kind: 'setup' } | { kind: 'help' };

/** "2pm", "2:30 pm", "14:00", "9" (a bare number is read as working hours: 1–6 → PM). */
export function parseTime(t: string): { hour: number; minute: number } | null {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\b|\s|$)/i.exec(t.replace(/\bnoon\b/i, '12pm'));
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && hour < 12) hour += 12;
  else if (ap === 'am' && hour === 12) hour = 0;
  else if (!ap && hour >= 1 && hour <= 6) hour += 12;
  return { hour, minute };
}

export function classify(text: string): Intent {
  const t = text.trim().toLowerCase().replace(/[’]/g, "'");
  if (isAutomationRequest(text)) return { kind: 'proposal' };
  if (/\b(text|sms)\b.*\b(customer|them|him|her)\b|\btext (a |the )?customer|\bsend (a )?text/.test(t)) return { kind: 'cantYet', what: 'text' };
  if (/\bstatements?\b/.test(t) && /\b(send|email|mail|make|prepare|create)\b/.test(t)) return { kind: 'cantYet', what: 'statement' };
  if (/\b(route|optimi[sz]e|best order|directions)\b/.test(t)) return { kind: 'cantYet', what: 'route' };
  if (/\b(charge|take) (a |the )?(card|payment)\b|\bcredit card\b/.test(t)) return { kind: 'cantYet', what: 'payment' };
  if (/why (can'?t|cannot|can not|am i not able to|won'?t it let me) (i )?approve|\bcan'?t approve\b|not allowed to approve/.test(t)) return { kind: 'whyCantApprove' };
  if (/\b(who|which drivers?|any(one|body)?|drivers?)\b.*\b(free|available|open)\b/.test(t)) {
    const time = parseTime(t.replace(/\b(today|tomorrow)\b/g, ''));
    if (time) return { kind: 'driversFree', day: /\btomorrow\b/.test(t) ? 'tomorrow' : 'today', ...time };
  }
  const price = /\b(?:how much (?:is|are|do we charge for|does|for)|what(?:'s| is| do we charge for)? (?:the )?(?:price|rate|cost) (?:of|for)|price (?:of|for)|rate (?:for|of))\s+(?:a |an |the )?([a-z][a-z \-]{1,40}?)\??$/.exec(t);
  if (price && !/\bowe/.test(t)) return { kind: 'price', item: price[1].trim() };
  // "When is Grace Okafor's next visit?", "What does Hollis owe?", "Grace's balance"
  const next = /\b(?:when is|when's|what is|what's)\s+(.+?)'s?\s+next (?:visit|delivery|job|service|pump-?out)/.exec(t) ?? /\bnext (?:visit|delivery|job|service) (?:for|at) (.+?)\??$/.exec(t);
  const owes = /\b(?:what|how much) (?:does|do) (.+?) owe\b/.exec(t) ?? /\b(.+?)'s? (?:balance|account)\b/.exec(t) ?? /\bbalance (?:for|of) (.+?)\??$/.exec(t);
  if (next || owes) {
    const name = (next?.[1] ?? owes?.[1] ?? '').replace(/^(the|customer)\s+/, '').trim();
    if (name) return { kind: 'customer', name, wants: next && owes ? 'both' : next ? 'next' : 'owes' };
  }
  if (/attention|need(s)? me|to ?do|waiting|approv/.test(t)) return { kind: 'attention' };
  if (/why|held|hold|blocked|stuck|fail/.test(t)) return { kind: 'held' };
  if (/today|schedule|my jobs/.test(t)) return { kind: 'today' };
  if (/set ?up|start|configure|onboard|ready/.test(t)) return { kind: 'setup' };
  return { kind: 'help' };
}
