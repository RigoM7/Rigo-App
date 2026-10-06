// Company accent colors are validated for contrast and adjusted into accessible variants so that
// any company's branding stays readable in both themes. Rigo's own red remains the default.

export const ACCENT_PRESETS = [
  { name: 'Rigo crimson', hex: '#B91C1C' },
  { name: 'Ember orange', hex: '#C2410C' },
  { name: 'Forest green', hex: '#15803D' },
  { name: 'Harbor blue', hex: '#1D4ED8' },
  { name: 'Royal purple', hex: '#7E22CE' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Graphite', hex: '#3F3F46' },
];

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgbToHex([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
function mix(hex: string, target: string, t: number) {
  const a = hexToRgb(hex), b = hexToRgb(target);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Move a color toward black/white until it reaches the contrast target against `bg`. */
export function adjustFor(hex: string, bg: string, target: number) {
  if (contrast(hex, bg) >= target) return hex;
  const toward = luminance(bg) > 0.5 ? '#000000' : '#FFFFFF';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(hex, toward, t);
    if (contrast(c, bg) >= target) return c;
  }
  return toward;
}

export interface AccentVariants {
  usable: boolean;
  base: string | null;
  /** Fill for accent surfaces with white text, light theme. */
  light: string;
  /** Accent used as text/indicator on near-black surfaces. */
  dark: string;
}

export function accentVariants(hex: string | null | undefined): AccentVariants {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return { usable: true, base: null, light: '#B91C1C', dark: '#F87171' };
  const light = adjustFor(hex, '#FFFFFF', 4.5);           // white text on it, and it as text on white
  const dark = adjustFor(hex, '#161618', 4.5);             // as text/indicator on dark surfaces
  // Reject colors that had to be pushed almost to black or white; they no longer read as the brand.
  const usable = contrast(light, '#FFFFFF') >= 4.5 && light !== '#000000' && dark !== '#FFFFFF';
  return { usable, base: hex.toUpperCase(), light, dark };
}
