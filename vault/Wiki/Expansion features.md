---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo IMPLEMENTATION-STATUS (2026-10-06)]]"]
---
# Expansion features

| Feature | What it does | Status |
|---|---|---|
| **CSV imports** | Customers with locations, trucks/equipment. Field mapping, preview, validation, duplicate and ambiguity detection, explicit commit, safe failure. Never activates workflows or invents relationships. | Verified. XLSX deferred (users save as CSV). |
| **Templates** | Services, fields, role permissions, workflows. Private, shared with chosen people, or public. Applying copies it as drafts; later template edits never change a company. Rates, people, records, files and credentials are never shared. | Verified |
| **Recurring service and rentals** | Visit schedules separate from billing schedules; time-zone aware; idempotent generation; pauses; future changes; missed-visit detection; restart catch-up. | Verified (generation, billing, pause) · Implemented (change, end) |
| **Communications** | Prepared, simulated, queued, sent, delivered, failed, replied; linked to customers, jobs, invoices. Without a provider, messages stay Prepared and people can mark "sent outside Rigo". | Implemented |
| **Branding** | Logo (PNG/JPEG/WebP ≤512 KB, no SVG) and an accent color with derived accessible variants. Shown only on the company chip, invoice header and message preview. | Verified (contrast) · Implemented (upload) |
| **Offline driver drafts** | IndexedDB per user + company, sync states, conflicts. | Verified (UI, server reconciliation); airplane-mode test not automated |
| **PWA install** | Manifest, icons, service worker. | Implemented |

## Related
- [[Status - built, simulated, blocked]] · [[Design system]] (branding)
