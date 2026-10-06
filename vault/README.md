# Rigo vault

An Obsidian vault that gives Claude a memory for Rigo between sessions.

| Folder | What goes in it |
|---|---|
| `Raw` | Dump anything here: notes, docs, brand guidelines, transcripts, research. Don't organize it. |
| `Wiki` | Structured, linked notes Claude builds from `Raw`. Start at [Wiki/Index.md](Wiki/Index.md). |
| `Output` | Answers, plans and deliverables Claude produces, kept for the next session. |

## Open it in Obsidian
Pull the repository, then in Obsidian choose **Open folder as vault** and pick `Rigo-App/vault`. New notes you create in Obsidian land in `Raw` by default.

## Use it with Claude Code
```bash
cd Rigo-App/vault
claude
```
`vault/CLAUDE.md` loads automatically and tells Claude to read `Wiki/Index.md` first, so each session starts with the context. Useful asks:
- "Organize what's new in Raw into the Wiki."
- "Read the wiki, then plan X. Save the plan to Output."
- "What's still open for the owner?"

## Keep private material private
The repository is public, so everything committed here is public. Put private notes, transcripts and anything with customer or personal details in `Raw/private/`; git ignores every folder named `private`, and Claude keeps what it builds from them in `Wiki/private/` and `Output/private/`.
