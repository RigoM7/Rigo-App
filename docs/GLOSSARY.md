# Rigo glossary

One name for each thing, used the same way in the menu, page titles, buttons, messages and
documentation (R18-m2). When a screen needs a new word, add it here first. Spanish names are in
`src/shared/i18n/es.ts` and still need review by a Spanish speaker.

## Work

| Use | Not | Meaning |
| --- | --- | --- |
| **Job** | ticket, order, work order, task | One piece of work for a customer at one location: a delivery, a pump-out, a unit service. Numbered (`#54`). |
| **Visit** | stop (in office text), trip | The driver being on site for a job. "The visit could not be completed." A job has one visit; a follow-up is a new job. |
| **Stop** | visit (on the driver side) | A job on a driver's list for the day, in order ("Today's stops in order"). Driver screens only. |
| **Draft** | pending, incomplete | A job that still lacks something it needs (a customer, a service or a required field). Drivers never see drafts. |
| **Open** | scheduled, active | A complete job, ready to be assigned and done. |
| **In progress** | started, active | The driver has started the job. |
| **Completed / Partially completed / Unsuccessful visit / Cancelled** | done, failed, closed | How a job ended. "Unsuccessful" is never billed automatically. |
| **Unassigned** | no driver yet, not assigned, open slot | A job without a driver. |
| **On my way** | en route, dispatched | The driver has said they are heading to the job, with an optional arrival estimate. |
| **Hand over** | transfer, reassign (by the driver) | A driver giving their job to another driver. Office staff **reassign**. |
| **Recurring service & rentals** | recurring & rentals, plans, schedules | Work that repeats (a weekly pump-out) and units out on rent, billed per 28-day cycle. |
| **Priority: Normal / Urgent / Emergency** | high, critical, ASAP | How soon a job must be done. Emergencies go to the top of the driver's list. |

## People and places

| Use | Not | Meaning |
| --- | --- | --- |
| **Customer** | client, account | Who the work is for and who is billed. |
| **Location** | site, address (as a thing) | A place where work happens for a customer. A customer can have several. |
| **Site contact** | contact (alone) | The person to call at a location. |
| **Billing contact** | AP, accounts payable contact | Who receives invoices when it isn't the main contact. |
| **Team member** | user, staff, employee | Someone with access to the company. |
| **Owner / Dispatcher / Driver / Office (billing)** | admin, manager, tech | The standard roles. Owners can always do everything. |
| **Trucks & equipment** | resources, assets, fleet items | Trucks, trailers and units (portable toilets, hand-wash stations). "Truck" alone is fine when it is a truck. |

## Money

| Use | Not | Meaning |
| --- | --- | --- |
| **Invoice** | bill, statement (for one job) | What the customer owes for one or more jobs or a rental cycle. |
| **Invoice draft** | pending invoice | Prepared but not issued; can still change. |
| **On hold** | blocked, error | An invoice that needs a person (a missing rate, an unusual quantity). It shows why. |
| **Approve / Issue** | finalize, send | Approve: a person agrees with the amounts. Issue: it gets its number and is owed. |
| **Void** | delete, cancel (an invoice) | An issued invoice that no longer applies. It keeps its number. |
| **Payment / Credit** | receipt, refund (for credit) | Money received; extra becomes credit for the next invoice. |
| **Statement** | account summary | A customer's open invoices and recent payments as of a date. |
| **Reminder** | dunning, notice | A prepared message about an invoice due soon or overdue. |
| **Rate** | price (for a unit) | The amount per gallon, per unit or per job. **Price** is fine in everyday sentences. |

## Messages and automation

| Use | Not | Meaning |
| --- | --- | --- |
| **Message** | communication, notification (to customers) | An email or text to a customer. Always **prepared** first. |
| **Prepared / Sent / Simulated** | queued, delivered (unless it was) | Prepared: written, not sent. Sent: a service accepted it. Simulated: demo, nothing left Rigo. |
| **Text** | SMS | A text message. |
| **Notification** | alert, message (to the team) | Something in the bell for a team member. |
| **Workflow** | automation rule, recipe | A rule: when something happens, what Rigo prepares or does. |
| **Automation** | engine, bot | The page showing workflows running, what waits for a person, and the pause switch. |
| **Approval** | sign-off, review request | A workflow step waiting for a person to decide. |
| **Assistant** | AI, chatbot | Answers questions from your data and drafts workflows. Says when an answer is prepared rather than AI. |

## Setup

| Use | Not | Meaning |
| --- | --- | --- |
| **Company** | workspace (in sentences), tenant, org | A business in Rigo. The list of companies is **Workspaces**. |
| **Services & pricing** | products, catalog | What the company offers, the form the driver fills in, and how each is priced. |
| **Template** | blueprint, preset | A copy of a company's structure (services, fields, roles, workflows), never its customers or records. |
| **Import** | upload, migration | Bringing customers or equipment in from a CSV file, reviewed before anything is saved. |
| **Test inbox** | simulated mailbox, dev mailbox | On a local copy, where account emails appear instead of being sent. |

## Words never shown to people

Permission keys (`jobs.view_all`), action and trigger keys (`invoice.prepare`, `job.completed`),
field keys (`requested_qty`), raw time zone IDs (`America/Chicago`), "(cents)", "Invalid input" and
other validator wording. The browser suite checks every page for them.
