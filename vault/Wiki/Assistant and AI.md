---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo UI-GUI-PROMPT (2026-10-06)]]", "[[repo README (2026-10-06)]]"]
---
# Assistant and AI

- Its own full screen (and the Assistant link in the top bar). Elsewhere, only small **"Ask Rigo"** chips on held invoices and blocked or failed steps, which open the Assistant with the question prefilled.
- Answers from the user's **authorized** data, explains exceptions, and turns plain-language requests into **workflow proposals** that stay separate from active configuration until accepted, tested and activated.
- Conversation states: Proposed, Waiting for approval, Running, Completed, Failed, Simulated.
- **No AI by default.** Without a provider it uses a rule-based builder and answers labeled **"Prepared response (not AI)"**. AI output is labeled as AI.
- Real AI sits behind a replaceable provider boundary: `RIGO_AI_PROVIDER=anthropic` plus `ANTHROPIC_API_KEY` (and optional `RIGO_AI_MODEL`, `RIGO_AI_DAILY_LIMIT`). Real companies only, never the [[Demo]], rate-limited per company, and company data is treated as untrusted input.
- Not yet exercised against the live API. Turning it on is an owner decision: see [[Open questions]].

## Related
- [[Automation, workflows and approvals]] · [[Status - built, simulated, blocked]]
