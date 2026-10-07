## What changed
<!-- One or two lines, in plain words. Area: see docs/CODEMAP.md. -->

## Checklist
| Check | Result |
|---|---|
| Isolation: company-owned queries scoped by `company_id` | |
| Permissions on the server; financial and contact fields removed on the server | |
| Money: exact math in `src/shared/`; missing rates hold | |
| Honest states; demo companies never reach a provider | |
| Migrations: new files only, additive, kept out of previews, applied at launch | |
| Screens: tokens, required states, four widths, both themes | |
| Tests added, including a permission or isolation case | |
| Docs match the code (`docs/FEATURES.md`, `docs/CODEMAP.md`, `DESIGN.md`, `PRODUCT.md` decisions) | |
| Security review (sign-in, permissions, customer data) | |

## Decisions
<!-- Choices made without asking, and why. -->

## How it was checked
<!-- Typecheck, area tests, screenshots, anything not verified. -->
