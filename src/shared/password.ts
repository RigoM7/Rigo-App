// Password rule shared by sign-up, password reset and password change. The server passes the
// large common-password list; the web app can run the same checks without it.

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const PASSWORD_HINT = 'At least 10 characters. A short phrase of three or four unrelated words works well.';
export const PASSWORD_TOO_EASY = 'This password is too easy to guess. Try three or four unrelated words.';
export const PASSWORD_PERSONAL = "Don't use your name or email address in your password. Try three or four unrelated words.";

// Runs of characters people type in order. A password that is a run (or a reversed run) of any of
// these, including a run that wraps around, is a sequence.
const SEQUENCES = [
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p',
  'qazwsxedcrfvtgbyhnujmikolp',
];

function isSequence(s: string) {
  if (s.length < 4) return false;
  for (const seq of SEQUENCES) {
    const loop = seq.repeat(Math.ceil((s.length * 2) / seq.length) + 2);
    const rev = [...loop].reverse().join('');
    if (loop.includes(s) || rev.includes(s)) return true;
  }
  return false;
}

/** True when the password is one short chunk repeated, such as "aaaaaaaaaa" or "abcabcabca". */
function isRepeat(s: string) {
  for (let n = 1; n <= 4 && n < s.length; n++) {
    const unit = s.slice(0, n);
    if (unit.repeat(Math.ceil(s.length / n)).slice(0, s.length) === s) return true;
  }
  return false;
}

/** The parts of a name or email that are long enough to matter (3+ letters or digits). */
function personalParts(email?: string, name?: string) {
  const parts = new Set<string>();
  const local = (email ?? '').split('@')[0].toLowerCase();
  if (local.replace(/[^a-z0-9]/g, '').length >= 3) parts.add(local.replace(/[^a-z0-9]/g, ''));
  for (const p of local.split(/[^a-z0-9]+/)) if (p.length >= 3) parts.add(p);
  for (const p of (name ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (p.length >= 3) parts.add(p);
  return [...parts];
}

/**
 * Returns a plain-language problem with the password, or null when it is acceptable.
 * `isCommon` checks a list of common passwords (server only).
 */
export function checkPassword(password: string, who: { email?: string; name?: string } = {}, isCommon?: (lower: string) => boolean): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`;
  const lower = password.toLowerCase();
  const compact = lower.replace(/[\s\-_.]+/g, '');
  if (isRepeat(lower) || isRepeat(compact) || isSequence(compact)) return PASSWORD_TOO_EASY;
  if (isCommon) {
    // A common password with numbers or symbols added at either end ("password123!") is still common.
    const core = compact.replace(/^[^a-z]+|[^a-z]+$/g, '');
    if (isCommon(lower) || isCommon(compact) || (core.length >= 4 && isCommon(core))) return PASSWORD_TOO_EASY;
  }
  if (personalParts(who.email, who.name).some((p) => compact.includes(p))) return PASSWORD_PERSONAL;
  return null;
}
