// Common email domain typos. Used to suggest a correction under email fields; never blocks.

export const EMAIL_MAX = 254;

const DOMAIN_FIXES: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com',
  'gmail.cmo': 'gmail.com', 'gmaul.com': 'gmail.com', 'gmeil.com': 'gmail.com', 'gimail.com': 'gmail.com',
  'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'hotamil.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hormail.com': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahooo.co': 'yahoo.com', 'tahoo.com': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outllook.com': 'outlook.com', 'outlook.co': 'outlook.com',
  'outlook.con': 'outlook.com', 'otlook.com': 'outlook.com', 'outlookk.com': 'outlook.com',
  'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icloud.con': 'icloud.com',
  'aol.co': 'aol.com', 'aol.con': 'aol.com', 'comcast.ner': 'comcast.net', 'comcats.net': 'comcast.net',
  'sbcglobal.ner': 'sbcglobal.net', 'att.ner': 'att.net', 'verizon.ner': 'verizon.net', 'live.co': 'live.com',
};

/** Suggests a corrected address for a common domain typo, or null. */
export function suggestEmail(email: string): string | null {
  const at = email.trim().lastIndexOf('@');
  if (at < 1) return null;
  const local = email.trim().slice(0, at);
  const domain = email.trim().slice(at + 1).toLowerCase();
  let fixed = DOMAIN_FIXES[domain];
  if (!fixed && /\.(con|cmo|ocm|vom|comm)$/.test(domain)) fixed = domain.replace(/\.(con|cmo|ocm|vom|comm)$/, '.com');
  return fixed && fixed !== domain ? `${local}@${fixed}` : null;
}
