---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo IMPLEMENTATION-STATUS (2026-10-06)]]", "[[repo README (2026-10-06)]]"]
---
# Automation, workflows and approvals

## Modes
| Mode | Behavior |
|---|---|
| **Manual** | People start every business action; Rigo lists the next step |
| **Assisted** | Rigo prepares drafts; anything that commits waits for a person |
| **Automatic** | Eligible steps run, but **never bypass approvals** |

Set per company, overridable per workflow and per step.

## Workflows
- Trigger → conditions → steps, plus approvals (always or conditional; approver roles or people; backups; escalation) and exception paths.
- Plain-language explanation, validation, and sample-data tests per mode.
- Versions: **Draft → Tested → Active**. Editing a tested version creates a new draft. Activation needs a test and is deliberate.
- Three editors share one versioned definition: guided form, visual builder, and the [[Assistant and AI|assistant]] (proposals stay separate until accepted, tested and activated).

## Safety
- Approvals bind to the **record version and workflow version**; editing makes them stale.
- Every attempt (including retries) rechecks pause state, workflow version, membership/permission and capability.
- Bounded retries with backoff; idempotency keys on every action.
- Loop/fan-out limits: event depth ≤3, ≤10 runs per event, ≤300 actions per hour per company.
- **Timeouts and escalation never approve.** Backups and owners are notified instead.

## Control surfaces
Company and workflow pause (hold or cancel queued work), resume, owner takeover of a run, visible queue and history, explanations for blocked steps. The Inbox states the consequence of approve, reject and edit.

## Engine
Durable tables `events → automation_runs → actions → approvals`. Locally an in-process worker runs them; on Vercel there's no always-on process, so due work runs at the end of each state-changing request and in a daily cron (`/api/cron/tick`). A quiet company may wait until the next request or cron. See [[Deployment and data]].

## Related
- [[Dispatch to invoice journey]] · [[Product principles]] · [[Status - built, simulated, blocked]]
