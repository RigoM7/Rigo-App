---
type: output
date: 2026-10-06
request: Set up an Obsidian vault with Raw, Wiki and Output folders, dump the material into Raw, organize it into Wiki, and save results to Output.
related: ["[[Index]]", "[[Log]]", "[[Open questions]]"]
---
# Vault setup

## What was built
- `vault/` in the Rigo-App repository, openable in Obsidian as a vault, with `Raw`, `Wiki` and `Output`.
- `vault/CLAUDE.md`: loads whenever Claude works in the vault and tells it to read [[Index]] first, organize new `Raw` files into the wiki, and save results here.
- Obsidian settings: new notes and attachments land in `Raw`; links stay `[[wikilinks]]`.
- Any folder named `private/` is ignored by git, because the repository is public.
- Vercel skips builds for commits that only change `vault/`, so wiki updates don't use deployments.

## What went into Raw
25 files, unedited: the six repository docs (README, CLAUDE, product vision, design system, UI/GUI prompt, implementation status), the six slash-command prompts, the git log, and the descriptions of all 12 pull requests. Google Drive wasn't readable from the session, and private notes or transcripts don't belong in a public repository, so none were added. Drop those into `Raw/private/` on your machine.

## What the wiki now covers
20 notes, counting the index and the log: product (overview, principles, roles, accounts, the dispatch-to-invoice journey, billing, automation, assistant, demo, expansion), design and engineering (design system, stack, deployment), state (status, history, open questions), and reference (working with Claude, glossary, log).

## Things found while organizing
- **The rebuild dropped some Era 1 ideas:** sharing between companies, an "All my companies" view, paid address lookup with caps, and separate billable quantities that need an owner's reason. Today a different billed quantity is done by editing the draft invoice's lines. Listed in [[Open questions]] in case you want any back.
- **Four owner decisions block features:** email service, support address, terms and privacy URLs, and turning on real AI. See [[Open questions]].
- Old PR descriptions mention `docs/PLATFORM.md`, `docs/DISTRIBUTION.md` and `DEPLOYMENT.md`. Those belonged to the first app and no longer exist; [[Project history]] keeps the useful parts.

## Next
- Drop new material into `Raw` (or `Raw/private`) and ask Claude to organize it.
- Answer items in [[Open questions]]; Claude records each decision with its date.
