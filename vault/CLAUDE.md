# Rigo knowledge vault

This folder is an Obsidian vault and Claude's long-term memory for Rigo. It has three folders:

- `Raw/`: the dump. Notes, docs, brand guidelines, transcripts, research, exactly as dropped in, unorganized.
- `Wiki/`: structured, linked notes that Claude builds from `Raw`. Start at `Wiki/Index.md`.
- `Output/`: answers, plans and deliverables Claude produces, so the next session builds on them.

The repository's own rules (`../CLAUDE.md`) still apply. For the app itself, `docs/` and the code are the source of truth; if the wiki disagrees with them, they win and the wiki gets fixed.

## At the start of every session
1. Read `Wiki/Index.md`, then the wiki notes the task needs, before anything else.
2. Skim the newest files under "Recent outputs" in the index when they relate to the task.
3. Compare `Raw/` with `Wiki/Log.md`. If there are unlisted files, say how many and offer to organize them (or do it when the task depends on them).

## Organizing `Raw` into `Wiki` ("ingest", "organize Raw", "add what's new")
- Process every `Raw` file not yet listed in `Wiki/Log.md`, including files in subfolders.
- Fold each fact into the note it belongs to. Update an existing note rather than making a near-duplicate; create a new note only for a new topic. One topic per note, titled in plain words.
- Link with `[[wikilinks]]` by note title. Every note ends with a `## Related` list and starts with frontmatter: `type`, `updated` (YYYY-MM-DD), and `sources` (wikilinks to the `Raw` files it came from).
- When sources conflict, keep the newer or more authoritative one, say so in the note, and add a line to `Wiki/Open questions.md` if the owner has to decide.
- Never edit, rename or delete files in `Raw`. They are the record. Images and PDFs stay in `Raw` and are embedded from wiki notes (`![[file.png]]`).
- Add new notes to `Wiki/Index.md` and append a dated batch to `Wiki/Log.md` listing each file processed.

## Saving results to `Output`
- Save every answer, plan, review, draft or deliverable worth keeping as `Output/YYYY-MM-DD <short title>.md`, with frontmatter: `type: output`, `date`, `request` (the ask, in a sentence), and `related` (wikilinks).
- Link it at the top of "Recent outputs" in `Wiki/Index.md`.
- Fold durable conclusions (decisions, facts learned) back into the relevant wiki notes, and record owner decisions in `Wiki/Open questions.md` with the date.

## Privacy: this repository is public
Everything committed under `vault/` is public on GitHub. Anything under a folder named `private/` (for example `Raw/private/`, `Wiki/private/`, `Output/private/`) is ignored by git and stays on the owner's machine.
- Material from `Raw/private/` is organized only into `Wiki/private/` and results from it go only into `Output/private/`. Never copy it into committed notes.
- Never put secrets, passwords, API keys, customer data or personal contact details in committed notes.

## Committing
Changes only under `vault/` (plus `.claude/` or `CLAUDE.md`) skip the Vercel build. Follow the repository's branch and pull request rules; don't push to `main` directly.
