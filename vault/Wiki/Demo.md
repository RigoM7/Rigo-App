---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo UI-GUI-PROMPT (2026-10-06)]]", "[[repo IMPLEMENTATION-STATUS (2026-10-06)]]"]
---
# Demo

- One fictional multi-service company (fuel, portable toilets, septic) **per visitor**, isolated and resettable.
- Guided dispatch-to-invoice walkthrough (inline, dismissible), free exploration, simulated **"View as"** role switching, Reset.
- **Set up my company** copies approved structure only, never records.
- An unmistakable black "Demo workspace" bar with a red hazard edge: "Fictional data. Nothing is sent, charged or connected."
- Never makes paid AI calls, sends email or SMS, processes payments, uses paid maps, connects accounts or uploads to external storage. Enforced at the server's provider boundary (`src/server/adapters/`) and tested with a `fetch` spy in `expansion.test.ts`.
- Simulated results are labeled Simulated. The landing page screenshots come from a fresh demo company (`scripts/landing-shots.mjs`).

## Related
- [[Product principles]] (rule 3) · [[Rigo overview]]
