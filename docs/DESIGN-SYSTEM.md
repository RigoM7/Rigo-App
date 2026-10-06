# Rigo design system

Source of truth for tokens: `src/client/styles.css`. Components: `src/client/components/ui.tsx`
and `src/client/components/shell.tsx`. Company accent logic: `src/shared/branding.ts`.

The UI UX Pro Max skill (`.claude/skills/ui-ux-pro-max`) was run for this product
(`"B2B SaaS field service operations dispatch dashboard" --design-system`, plus targeted `ux`
and `typography` searches for error summaries, focus not obscured, dragging alternatives,
accessible authentication, bottom navigation, responsive tables, dark-mode contrast and touch
targets). Its generic suggestions — a blue/orange palette, glassmorphism and a Calistoga/Inter
pairing — were **not adopted**: they conflict with the confirmed red/white/black brand,
restrained components and operational density. Its accessibility, navigation and form rules
were adopted and are listed under each section below.

## Character

Polished, technology-focused, confident and professional. Restrained surfaces, clear
hierarchy, red used deliberately. Operational screens favor clarity over decoration.

## Color

Confirmed palette: red, white and black. Rich crimson brands and drives primary actions;
bright red is reserved for selective highlights and active states. Every value is a semantic
token; components never use raw hex.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | #FAFAFA | #0B0B0D | Page background |
| `--surface` | #FFFFFF | #161618 | Cards, bars, dialogs |
| `--surface-2` / `--surface-3` | #F4F4F5 / #E9E9EC | #1F1F23 / #2A2A2F | Hover, wells, skeletons |
| `--text` | #111111 | #FAFAFA | Primary text |
| `--text-2` | #52525B | #A1A1AA | Secondary text |
| `--text-3` | #71717A | #8B8B94 | Placeholders, tertiary |
| `--border` / `--border-strong` | #E4E4E7 / #C9C9CF | #2A2A2F / #3F3F46 | Dividers, card edges (decorative) |
| `--control-border` | #7A7A84 | #7A7A84 | Edges of inputs, buttons, choice cards (≥3:1) |
| `--primary` | #B91C1C | #DC2626 | Primary buttons, brand mark |
| `--primary-hover` / `--primary-press` | #991B1B / #7F1D1D | #B91C1C / #991B1B | Button states (white text stays ≥4.5:1) |
| `--primary-text` | #B91C1C | #F87171 | Red used as text or links |
| `--highlight` | #EF4444 | #EF4444 | Active tab/nav indicators only (non-text) |
| `--focus` | #111111 | #FAFAFA | 3px focus outline, 2px offset |
| `--success`, `--warning`, `--info`, `--danger` (+ `-soft`) | see CSS | see CSS | Status pills and banners |

Measured contrast (WCAG 2.x formula, `src/shared/branding.ts`):

| Pair | Ratio |
|---|---|
| Text on canvas (light / dark) | 18.09 / 18.84 |
| Secondary text on surface (light / dark) | 7.73 / 7.05 |
| Tertiary text on surface (light / dark) | 4.83 / 5.35 |
| White on primary (light #B91C1C / dark #DC2626) | 6.47 / 4.83 |
| White on primary hover (light #991B1B / dark #B91C1C) | 8.31 / 6.47 |
| Red text: #B91C1C on white / #F87171 on dark surface | 6.47 / 6.53 |
| Bright highlight #EF4444 as indicator: on white / on dark | 3.76 / 4.80 (non-text, ≥3:1) |
| Control border #7A7A84 on white / on dark surface | 4.25 / ≥3.87 |
| Status text on soft backgrounds (light) | 4.79–6.84 |
| Status text on soft backgrounds (dark) | 9.25–9.64 |
| Focus ring (light / dark) | 18.88 / 17.31 |

White text is **not** used on #EF4444 (3.76:1). In dark mode, button hover darkens instead of
brightening for that reason.

**Errors and destructive actions are not brand red.** They use the `danger` token, an icon
(alert/trash/ban), explicit labels ("Remove member", "Void invoice", "Cancel job"), the
outlined `btn-danger` style rather than a filled red button, and a confirmation dialog that
states the consequence.

### Themes

Light, Dark and System. **Light is the default** (brief requirement; a predictable look for
first-time and shared-device users). The preference is saved to the account and the device
(`localStorage`), applied before first paint by an inline script, and System follows
`prefers-color-scheme` live. Both themes are tested independently (axe scan of 17 pages each).

### Company branding

Companies may upload a logo (PNG/JPEG/WebP ≤512 KB; SVG rejected; bytes are sniffed) and pick
an accent from presets or a hex value. `accentVariants()` derives a light variant (≥4.5:1 on
white, usable under white text) and a dark variant (≥4.5:1 on dark surfaces), and rejects
colors that cannot be made readable. The accent appears in the company chip, active-nav
indicator, invoice header and message previews. Navigation, controls and primary actions stay
Rigo's, so every workspace behaves the same. No company CSS or scripts.

## Typography

- **Poppins** (600, 700) for headings and key numbers — distinctive and confident.
- **Open Sans** (400, 600, 700) for everything else — highly readable at small sizes.
- Self-hosted via `@fontsource` (no external font requests; works offline in the PWA).
- Base 16px / 1.5. Inputs are 16px (prevents iOS zoom). Scale: h1 26px, h2 20px, h3 17px,
  small 14px, labels 15px semibold. Uppercase only for table headers and nav section labels.
- Numbers in tables, totals and stats use `font-variant-numeric: tabular-nums`.

## Spacing, shape, elevation, icons

- 4px base scale: 4, 8, 12, 16, 24, 32, 48.
- Radius: 6px small, 8px controls, 12px cards and dialogs.
- Borders: 1px subtle. Shadows: one resting level, one overlay level.
- Icons: **Lucide** only, 18–22px, 2px stroke. Decorative icons beside text are
  `aria-hidden`; icon-only buttons have accessible names.

## Motion

`--dur-fast` 120ms and `--dur` 200ms with a standard ease. Used for hover/press, toasts,
progress bars and skeleton shimmer only. No decorative or scroll-triggered motion.
`prefers-reduced-motion` sets durations to zero and stops animation.

## Components

| Component | Rules |
|---|---|
| Button | Min 44px tall; variants primary (filled red), default (outlined), ghost, danger (outlined, icon). Busy state disables and shows a spinner. |
| Field | Visible label always; optional fields say "(optional)"; hint text linked by `aria-describedby`; inline error with icon; invalid fields get a 2px danger border and `aria-invalid`. |
| ErrorSummary | After a failed multi-field submit: `role="alert"`, receives focus, lists each error as a link to its field; inline errors remain. |
| PasswordInput | Show/hide toggle with `aria-pressed`; paste and password managers allowed; correct `autocomplete`. |
| Pill (status) | Always icon + text; never color alone. Separate families for job, invoice, action, message, payment. |
| Banner | info / warning / danger / success with icon and title; danger uses `role="alert"`. |
| Dialog | Native `<dialog>` (focus trap, Escape), labelled title, footer actions; consequences stated in the body. |
| Table | Desktop table; below 768px becomes labelled cards (`data-label`) instead of scrolling the page sideways. |
| Tabs / Segmented | Real buttons with `aria-selected`/`aria-pressed`; wrap at narrow widths or scroll within their own strip. |
| Empty / Loading / Error | Every list has an empty state with a next action; skeletons while loading; error states with retry; 403/404 explained. |
| Toast | `role="status"`, top of screen (never over the driver's action bar), dismissible, 6s. |

## Layout and navigation

- **≥1024px**: sticky top bar (brand, company switcher, role, assistant toggle, bell,
  account), left sidebar grouped Operations / Billing / Rigo / Company with an accent bar on the
  active item, main content max 1240px.
- **≥1280px**: collapsible assistant side panel (remembered per device).
- **<1024px**: top bar plus a bottom navigation of **at most five** role-specific destinations
  (four + More); everything else under **More**. The assistant is its own screen.
- Real routes for every screen (`/c/:companyId/...`), so deep links and back work. Switching
  companies reloads the app so no data from the previous company can remain on screen.
- Sticky elements never cover content or focus: `scroll-padding` offsets, bottom padding equal
  to the nav height, the demo walkthrough is inline (not floating), toasts sit at the top.

## Density by role

- **Owner/dispatcher**: fuller tables, filters, board and schedule.
- **Driver**: one column (max 640px), 56px choice rows, large next-action buttons, sticky
  submit bar, address/time/access instructions first, sync state always visible.

## Accessibility checklist (verified by `e2e/run.mjs` unless noted)

- axe WCAG 2.0/2.1/2.2 A+AA: no violations on 17 pages, light and dark.
- No horizontal page overflow at 375, 768, 1024, 1440px, and at 200% text on 375px.
- Skip link first; visible focus outline; logical order; native controls.
- Reduced motion honored.
- Error summary receives focus on failed sign-up.
- Dragging is never required: assignment, reordering of fields/steps and workflow building use
  selects and Move up/Move down buttons. (Signature capture is inherently a drawing task and
  is paired with a typed signer name.)
- Manual review still recommended with a screen reader (VoiceOver/TalkBack) — not automated here.
