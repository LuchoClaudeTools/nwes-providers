# CLAUDE.md — nwes-providers

## Project Overview

**Northwest Eye Surgeons (NWES) Referring Provider Directory** — a single-page internal staff portal for browsing, searching, and managing optometrist/ophthalmologist co-management referral relationships.

This is a **single-file web application**: all HTML, CSS, and JavaScript live in `index.html`. There is no build step, no package manager, no server-side code.

---

## Architecture

### Files

| File | Purpose |
|---|---|
| `index.html` | The entire application (~2100 lines) |
| `providers.csv` | Live provider data (source of truth) |
| `notes/<username>.json` | Per-user sticky notes (one file per user, keyed by `provider_<id>`) |
| `archives/providers_YYYY-MM-DD.csv` | Archived snapshots of the CSV before major edits |

### Data Flow

1. On load, the app fetches `providers.csv` from GitHub raw URL (`raw.githubusercontent.com/LuchoClaudeTools/nwes-providers/main/providers.csv`) — no server involved.
2. Admin edits (add/edit/delete providers) serialize back to CSV and commit to GitHub via the GitHub Contents API (`api.github.com`).
3. The GitHub token is stored in `localStorage` (`nwes_gh_token`), set by the admin in the Settings & Sync tab.
4. Users and sessions are stored in `localStorage` (`nwes_users_v1`, `nwes_auth`) — there is no backend authentication.

### GitHub Repo

- Owner: `LuchoClaudeTools`
- Repo: `nwes-providers`
- Branch: `main`
- Constants defined at line ~1122 in `index.html`

---

## Provider Data Schema

`providers.csv` columns (in order):

| Field | Description |
|---|---|
| `id` | Integer, unique row ID |
| `displayName` | Doctor name or "Multiple ODs on Staff" |
| `practice` | Practice/clinic name |
| `address` | Street address |
| `city` | City, State ZIP |
| `phone` | Phone number |
| `website` | Website URL (no protocol) |
| `specialty` | `Optometrist`, `Comprehensive Ophthalmologist`, `Retina Specialist`, or `Primary Care` |
| `ownership` | `independent`, `pe` (private equity), `corporate`, or `hospital` |
| `catComanage` | `Yes`, `No`, or `Limited` — cataract co-management capability |
| `glaucTC` | `Yes`, `No`, or `Limited` — glaucoma team care capability |
| `distMain` | Distance from NWES main office (e.g. `4.2 mi`) |
| `distEast` | Distance from NWES East (New Albany) office |
| `doctors` | Pipe-separated (`\|`) list of all doctors at the practice |
| `notes` | Internal notes (freeform) |
| `confirmed` | `true` / `false` — whether the relationship has been personally verified |

---

## Features

- **Left panel**: searchable doctor list (by name)
- **Right panel**: practice name search + detailed provider card
- **Provider card**: contact info, distance badges, cataract/glaucoma co-management status, all-doctors chips, notes, verified badge
- **Sticky notes**: floating, draggable per-user private notes per provider; backed by GitHub (`notes/<username>.json`); cached in localStorage
- **Login**: username/password login with localStorage-based user store; session persisted in `localStorage`
- **Admin panel** (admin users only): tabs for Users & Permissions, Providers CRUD, and Settings & Sync
  - Users have optional `canEdit` and `canVerify` permission flags
  - Settings tab: set GitHub token, trigger manual archive, restore from archive

---

## Key JavaScript Sections (in `index.html`)

| Line range | Section |
|---|---|
| ~770–1117 | Sticky Notes System |
| ~1119–1130 | Constants (GitHub config, localStorage keys) |
| ~1134–1185 | CSV Parser |
| ~1187–1206 | CSV Serializer |
| ~1208–end | GitHub API, auth, UI rendering, admin logic |

---

## Development Notes

- **No build step** — edit `index.html` directly and open in browser, or push and serve from GitHub Pages.
- **Hosting**: likely served as a GitHub Pages site from the `LuchoClaudeTools/nwes-providers` repo.
- **CSV edits**: when modifying `providers.csv` directly (not via the admin UI), preserve the header order exactly. The serializer hard-codes the column order in `CSV_HEADERS`.
- **Archiving**: before bulk CSV edits, copy `providers.csv` to `archives/providers_YYYY-MM-DD.csv`.
- **Token security**: the GitHub token lives only in the browser's localStorage — never commit it to the repo.
- **Notes files**: `notes/Admin.json` and `notes/Dr__Louis_Hirsch.json` are per-user sticky note files. Usernames are sanitized (`/[^a-z0-9_\-]/gi` → `_`) to form filenames.

---

## Specialty/Ownership Display Logic

- `ownership` values map to color-coded badges: `independent` = green, `pe` = yellow, `corporate` = red, `hospital` = blue
- `catComanage` / `glaucTC` values: `Yes` = green, `No` = red, anything else (`Limited`, `Limited / Varies`) = yellow/warning
