# Design research: open-source projects Rigo builds on

`CLAUDE.md` asks that visual work start from open-source projects on GitHub with 1,000+ stars
related to what Rigo does, and that this file record what was used, from where and why.

**License rule:** Rigo has no open license.
- Code or assets may only be copied or adapted from permissive licenses (MIT, Apache-2.0, BSD,
  ISC, CC0). Copied code keeps its notice and is listed in `THIRD_PARTY_NOTICES.md`.
- Projects under GPL, AGPL, LGPL, SSPL, Elastic, BSL, fair-code or custom licenses are ideas
  and patterns only.
- `docs/DESIGN-SYSTEM.md` and the confirmed red/white/black palette win over anything here.

## Round 1 (October 7, 2026)

Star counts and licenses were checked on each repository page on that date (approximate, they
change).

### What we took this round

No code or assets were copied; each pattern was rebuilt in Rigo's own CSS and components.

| Rigo change | Pattern from | License | What we took |
|---|---|---|---|
| Home "Needs you" in three tiers (`src/client/pages/dashboard.tsx`) | [uswds/uswds](https://github.com/uswds/uswds) (~7.2k) | CC0 | The alert hierarchy: an emergency site alert first, then warnings, then information, so urgency is shown by position and weight, not just colour |
| | [novuhq/novu](https://github.com/novuhq/novu) (~40k) | MIT (outside `/enterprise`) | Inbox rows where every item carries its own primary action |
| Driver footer toolbar (`src/client/pages/driver.tsx`, `.sticky-actions`) | [ionic-team/ionic-framework](https://github.com/ionic-team/ionic-framework) (~52.7k) | MIT | A solid fixed footer with one full-width primary action and safe-area padding; secondary actions in the page |
| Job details stack on phones (`.driver-page .kv`) | [alphagov/govuk-frontend](https://github.com/alphagov/govuk-frontend) (~1.5k) | MIT | The Summary list: label above value on narrow screens so long values keep the full width at large text sizes |
| Customer "Next visit / Owes" facts (`src/client/pages/customers.tsx`) | [medusajs/medusa](https://github.com/medusajs/medusa) (~36.6k) | MIT (outside enterprise files) | Order summary that leads with the outstanding amount |
| | [crater-invoice/crater](https://github.com/crater-invoice/crater) (~8.3k) | AGPL-3.0 (ideas only) | Customer page with a prominent "amount due" |

### Already in Rigo, confirmed by the research

| Rigo feature | Matching open-source pattern |
|---|---|
| Timeline blocks change layout by width ("compact"), lanes grow to fit overlapping jobs, "+N more" for crowded unassigned work, 4-hour zoom, "Now" | react-calendar-timeline (MIT): width-aware item renderer; vis-timeline (Apache-2.0/MIT): lane height grows to fit overlaps, zoom limits, clustering; EventCalendar (MIT): visible-range presets and a now indicator |
| Ctrl K command menu | cmdk (MIT), kbar (MIT) |
| Job side panel from the timeline | Twenty (AGPL, ideas), Supabase Studio (Apache-2.0) side sheets |
| Undo after assigning a driver | react-admin (MIT) undoable mutations, Sonner (MIT) action toasts |

### Shortlist for later rounds

1. **Approvals inbox:** three panes (list, request, context), Mine / Unassigned / All tabs with counts, move to the next item after deciding. [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot), MIT outside `enterprise/`.
2. **Workflow builder and run history:** a vertical step list with "+" between steps and the editor in a side panel; a runs table with a per-step trace. [activepieces/activepieces](https://github.com/activepieces/activepieces) (MIT Community Edition), [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev) (Apache-2.0).
3. **Sidebar density:** grouped navigation with trailing counters, collapsible groups and favorites. [primer/react](https://github.com/primer/react) NavList (MIT), [shadcn-ui/ui](https://github.com/shadcn-ui/ui) Sidebar (MIT).
4. **Timeline at 25 trucks:** virtualized lanes with [TanStack/virtual](https://github.com/TanStack/virtual) (MIT); if the timeline is ever rebuilt on a library, [vkurko/calendar](https://github.com/vkurko/calendar) (EventCalendar, MIT) is the only free resource timeline. FullCalendar's resource timeline is commercial.
5. **Status colours:** [radix-ui/colors](https://github.com/radix-ui/colors) (MIT) 12-step scales for red, amber and green that hold contrast in light and dark.
6. **Driver offline state:** a visible "3 waiting to upload" counter and an undo after each answer. [streetcomplete/StreetComplete](https://github.com/streetcomplete/StreetComplete), GPL (ideas only).
7. **Language selector and step indicator for driver completion:** USWDS (CC0).
8. **"Today at a glance" row:** [tremorlabs/tremor](https://github.com/tremorlabs/tremor) Tracker and BarList (Apache-2.0).

### Ideas only (license)

**AGPL:** Fleetbase, Crater, InvoiceShelf, Lago, Midday, Bigcapital, Twenty (main code), Plane,
Documenso, Formbricks, Windmill.

**GPL:** ERPNext, Dolibarr, StreetComplete.

**LGPL:** Odoo.

**Other licenses:**
- Invoice Ninja (Elastic).
- Akaunting (BSL).
- n8n (Sustainable Use).
- Planby (custom).
- FullCalendar Premium (commercial).
- The enterprise folders of Twenty, Medusa, Chatwoot, Novu and Activepieces.

### Checked and below 1,000 stars (excluded)

OpenBoxes, Karrio, Fleetbase navigator-app, Bitnoise/react-scheduler, aldabil21/react-scheduler,
SVAR React Gantt, ODK Central and Collect, KoboToolbox.

### To recheck before reusing code

These were noted during research:
- Schedule-X: whether its resource views are premium.
- Cal.com: its recent switch to MIT.
- Chatwoot: the licensing of its `enterprise/` folder.
- twenty-ui: the package-level license.
- Archived projects (Pico CSS, tui.calendar, gantt-task-react): fine to read, but unmaintained.
