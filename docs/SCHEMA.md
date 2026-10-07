# Database map

A one-page guide to the `rigo` schema so you don't have to read `migrations/001_init.sql`
(+ `002_account_recovery.sql`) for every task. The SQL files are the source of truth: when
a migration adds or changes a table, update this page in the same change.

Rules that apply to every table below unless noted:
- Every company-owned row has `company_id` and every query filters on it.
- Ids are UUIDs (`gen_random_uuid()`); timestamps are `timestamptz`.
- Never edit an applied migration; add a new numbered file.

## Identity and sign-in (not company-owned)
| Table | What it holds |
|---|---|
| `users` | One row per person. Email, password hash, `email_verified_at`, `deleted_at` (accounts are anonymized, not removed). |
| `sessions` | Sign-in sessions. `id` is the SHA-256 of the cookie token; has `expires_at` and `last_seen_at`. |
| `password_resets` | Single-use reset links (hashed token, expiry, `used_at`, who issued it for which company). |
| `email_tokens` | Single-use links to verify an email or change it (`purpose` is `verify` or `change`). |
| `auth_attempts` | Sign-in attempt log used for rate limiting (`key`, `at`). |

## Companies and people
| Table | What it holds |
|---|---|
| `companies` | One row per business. `kind` is `real` or `demo` (demo companies never reach a provider). Branding and settings live here. |
| `roles` | Roles per company, keyed `(company_id, key)`, with their permissions. |
| `memberships` | Which user belongs to which company with which role. Status `active` or `removed`. |
| `invitations` | Pending, accepted, revoked or replaced invites; one pending invite per company and email. |
| `approval_delegations` | One user covering another's approvals for a date range. |

## Business records
| Table | What it holds |
|---|---|
| `customers` | Customers of a company. |
| `locations` | Service addresses, belonging to a customer. |
| `resources` | Trucks, equipment and units (`kind`); status `available`, `in_service`, `out_of_service` or `retired`. |
| `services` | Service definitions: fields, stages, pricing, tax, photo/signature requirements. |
| `jobs` | The core record. Numbered per company, has a `status`, assignee and schedule. |
| `job_resources` | Which resources are on which job (join table). |
| `job_events` | Timeline of what happened on a job (`type`, `actor`, JSON `data`). |
| `files` | Photos and signatures. `storage` is `local` or `database`; in the database the bytes sit in `data` (bytea). This is the table that grows fastest. |

## Invoicing
| Table | What it holds |
|---|---|
| `invoices` | One per billable event (`billable_key` is unique per company); number assigned when issued. |
| `invoice_lines` | Charges and discounts on an invoice. |
| `payments` | Payments against an invoice, deduplicated by `idempotency_key`. |

## Communications
| Table | What it holds |
|---|---|
| `messages` | Emails and texts: prepared, then sent or failed, with `status_detail`. Deduplicated by `source_key`. |
| `dev_mailbox` | Where messages and links land instead of a real provider when none is configured. Not company-owned. |
| `notifications` | In-app notifications per user, deduplicated by `dedupe_key`. |

## Workflows and automation
| Table | What it holds |
|---|---|
| `workflows` | Named workflows per company. |
| `workflow_versions` | Versions with status `draft`, `tested`, `active`, `retired` or `proposal`. |
| `events` | Business events that can trigger automations. |
| `automation_runs` | One run of a workflow for an event; deduplicated by `idempotency_key`. |
| `actions` | Individual steps a run wants to take (type, status), also deduplicated. |
| `approvals` | Human sign-off on an action: `pending`, `approved`, `rejected`, `stale` or `cancelled`. |

## Recurring service and rentals
| Table | What it holds |
|---|---|
| `recurring_plans` | Repeating service or rental plans (`kind` is `service` or `rental`); `active`, `paused` or `ended`. |
| `plan_occurrences` | Each scheduled occurrence of a plan (`scheduled`, `skipped_paused`, `cancelled`). |

## Imports and templates
| Table | What it holds |
|---|---|
| `imports` | CSV imports of `customers` or `resources`: uploaded, reviewed, committed, failed or discarded. |
| `templates` | Reusable setups shared from one company. Not company-owned (has `source_company_id`). |
| `template_shares` | Which emails a template is shared with. |
| `template_applications` | Where a template was applied in a company. |

## Assistant, usage and audit
| Table | What it holds |
|---|---|
| `assistant_messages` | Assistant conversation history per company. |
| `usage_counters` | Daily counts per company and `kind`, keyed `(company_id, kind, day)`. |
| `audit_log` | Who did what, with JSON `detail`. `company_id` can be null for platform-level actions. |
| `system_state` | Small key/value store for the app itself. |
| `schema_migrations` | Which migration files have been applied. |
