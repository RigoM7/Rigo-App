---
type: topic
updated: 2026-10-06
sources: ["[[repo DESIGN-SYSTEM (2026-10-06)]]", "[[repo UI-GUI-PROMPT (2026-10-06)]]", "[[PR 12 Redesign every screen as the Light command center UI]]"]
---
# Design system: "Light command center"

Summary only. The source of truth is `docs/DESIGN-SYSTEM.md` and `src/client/styles.css`; they win over this note and over any design skill.

## Character
Mission control for a field-service business: the owner opens Rigo and sees the day moving. Linear's speed and restraint, Vercel's black-and-white precision, fleet tools' focus on drivers and trucks, Stripe's calm money screens.

- **Light-first with black chrome:** near-black top bar and sidebar around a bright workspace. Light is the default; Dark and System exist.
- **Signature move:** the live dispatch timeline with a thin bright-red "now" line across driver lanes.
- **Never:** admin-template look (gradients, rows of identical icon cards, stock illustrations, hero metric tiles, eyebrow labels), important actions hidden in "…" menus or on hover, gradient text, glass/blur, neon glows, colored left borders thicker than 1px, emoji as icons, uppercase labels.

## Palette
Red, white, black, neutral grays, functional status colors.
- `--primary` #B91C1C (light) / #DC2626 (dark): primary buttons, wordmark.
- `--live` #EF4444: **indicators only** (now line, live dots, active-nav marker). Never behind white text.
- `--chrome` #0A0A0B: top bar, sidebar, bottom nav, toasts.
- Errors use `--danger` (#B42318), not brand red, with an icon and an explicit verb.
- Tokens come in three layers (primitive → semantic → component); no component uses a raw hex. Exceptions: printable invoice and customer email preview always render on white.

## Type, shape, motion
- **Geist** for UI, **Geist Mono** for data only (job numbers, quantities, money, times). Self-hosted. Base 16px. Scale 12–36.
- Radii 8px controls, 12px cards. 4px spacing scale. Operational buttons 44px; nothing below 24px. **Lucide** icons only.
- Motion explains state: 120 / 200 / 360ms. Reduced motion sets all durations to 0.

## Shell
- Desktop: black sidebar grouped Operations · People & places · Fleet · Money · Communication · Rigo · Setup; collapses to icons. Command menu on Ctrl/⌘K.
- Phone: bottom nav of at most five items (four + More). Tables become labelled cards below 768px. No horizontal page scroll.
- Driver screens: one column, big mono time, address first, 56px choice rows, sticky "Submit to office".

## Accessibility bar
axe WCAG 2.2 AA with no serious/critical violations in light and dark; no overflow at 375/768/1024/1440px and 200% text; skip link; visible focus; dragging never required. Screen-reader walkthroughs still manual.

## Related
- [[Working with Claude on Rigo]] (design skills) · [[Dispatch to invoice journey]]
