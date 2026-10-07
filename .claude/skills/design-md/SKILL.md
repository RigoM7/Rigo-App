---
name: design-md
description: Write, validate, compare and export DESIGN.md files, Google Labs' open format for describing a design system to coding agents (YAML design tokens plus markdown rationale). Use when asked to create or update a DESIGN.md, lint one for broken token references or WCAG contrast, diff two versions, or export its tokens to Tailwind or W3C DTCG tokens.json.
license: Apache-2.0
---

# DESIGN.md

DESIGN.md (google-labs-code/design.md, format version `alpha`, CLI `@google/design.md` 0.4.0)
describes a visual identity so any agent can reproduce it. One file holds:

- **YAML front matter**: machine-readable tokens (`colors`, `typography`, `rounded`, `spacing`,
  `components`), cross-referenced with `{colors.primary}` syntax. Tokens are the normative values.
- **Markdown body**: the rationale, in canonical section order: Overview, Colors, Typography,
  Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts. The prose carries the intent;
  the tokens support it.

Read [reference/spec.md](reference/spec.md) before writing or editing a DESIGN.md (schema, section
order, recommended token names, how consumers treat unknown content).
[reference/philosophy.md](reference/philosophy.md) explains why prose matters more than token
precision, and [reference/example-DESIGN.md](reference/example-DESIGN.md) is a complete example.

## CLI

Runs from npm with Node 18+. All commands take a path or `-` for stdin and print JSON.

```bash
npx -y @google/design.md@0.4.0 lint DESIGN.md            # exit 1 on errors
npx -y @google/design.md@0.4.0 diff DESIGN.md DESIGN-v2.md   # exit 1 on regressions
npx -y @google/design.md@0.4.0 export --format dtcg DESIGN.md > tokens.json
npx -y @google/design.md@0.4.0 export --format css-tailwind DESIGN.md > theme.css
npx -y @google/design.md@0.4.0 spec --rules              # spec plus the lint rules table
```

Export formats: `json-tailwind` (Tailwind v3 `theme.extend`), `css-tailwind` (Tailwind v4
`@theme`), `dtcg` (W3C Design Tokens). Lint rules: `broken-ref` (error); `missing-primary`,
`contrast-ratio` (component background/text pairs below 4.5:1), `orphaned-tokens`,
`missing-typography`, `section-order`, `unknown-key`, `token-like-ignored` (warnings);
`token-summary`, `missing-sections`, `omitted-rules` (info).

Pin the version as above so results don't change under you. On Windows/PowerShell use
`npx -p @google/design.md designmd <command>`.

## Workflow

1. **Create**: derive tokens from the real source (CSS custom properties, theme files), never
   invent values. Write the Overview first: who it is for and how it should feel. Then each
   section's prose, with tokens matching what the code actually uses.
2. **Validate**: run `lint`, fix every error, and fix or justify each warning.
3. **Change**: copy the file, edit it, run `diff` against the old version and report token-level
   changes and any new findings.
4. **Export** only when a consumer needs another format; DESIGN.md stays the source.

## In this repository (Rigo)

Rigo's design doc is `DESIGN.md` at the repository root, in this format: light-theme tokens in the
front matter, the dark theme and the rules in the body. The real values live in
`src/client/styles.css` (plain CSS custom properties, not Tailwind); fonts are Geist and Geist
Mono.

- Keep `DESIGN.md` and `styles.css` in sync in the same change: when a look request changes a
  token, change both.
- Lint after every edit to `DESIGN.md`. Its `orphaned-tokens` warnings are expected (colours the
  prose uses but no component token references); fix errors and any contrast finding.
- Don't change a token just to silence a warning; look changes follow `DESIGN.md`'s
  "Your words → skill" rules.
- Use `export` output for comparison or hand-off only, not to replace `styles.css`.
