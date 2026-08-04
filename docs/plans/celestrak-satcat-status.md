# CelesTrak SATCAT Operational Status Integration

Status: PR1 merged (paulhugel/AstriaGraph#10); PR2 implemented, pending PR
Branch: `claude/celestrak-satcat-status`
Worktree: `/Users/paulhugel/Projects/_WORKTREES/AstriaGraph/celestrak-satcat-status`
Base: `origin/master` @ `9f753c0` (Merge PR #9: stabilize cross-browser controls layout)

## Problem

AstriaGraph's GitHub Pages deployment (static/local-data mode, `UseLocalData = true`)
loads `assets/data/www_query_NODEB.tsv`, which is generated entirely from CelesTrak's
`gp.php?GROUP=active&FORMAT=json` feed by `scripts/fetch_celestrak.mjs`. On the live
site (https://paulhugel.github.io/AstriaGraph/) this renders the overwhelming majority
of objects as **GOLD ("Status unavailable")** instead of DarkOrange/Cyan
(Active/Inactive satellite).

## Root causes (both confirmed by direct inspection of `origin/master`)

1. **`DataSource` value mismatch.** `www_data_sources.tsv` maps code `CELESTRAK` →
   name `CelesTrak`. Every row in `www_query_NODEB.tsv` resolves to
   `DataSource == "CelesTrak"`. The color-classification logic in `main.js`
   (`DisplayObjects`, `statusKnown`/`active` arrays) only recognizes
   `DataSource == "UCS"` or `DataSource == "USSTRATCOM"`. `"CelesTrak"` matches
   neither, so every row fails the `statusKnown` check and is forced to GOLD.

2. **No operational-status field is fetched at all.** `scripts/fetch_celestrak.mjs`
   (`rowFromCelestrak`) only pulls `OBJECT_NAME`, `OBJECT_ID`, `NORAD_CAT_ID`,
   `EPOCH`, and mean orbital elements from the CelesTrak **GP** (General
   Perturbations) JSON. It never reads `OBJECT_TYPE`, and the GP feed does not
   carry CelesTrak's operational-status code at all — that lives in a separate
   feed, CelesTrak's **SATCAT**. As a result `BirthDate`, `Operator`, and every
   other metadata column are blank for all 13,301 rows, so even the legacy
   `USSTRATCOM`-style "BirthDate year >= 2017" active heuristic could never fire
   for this data source even if the `DataSource` string were fixed.

## What CelesTrak actually provides

Confirmed live via direct `WebFetch` against CelesTrak's own docs and endpoints
(not assumed from memory):

- **GP endpoint** (already used): `https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json`
  — orbital elements, no operational-status code.
- **SATCAT endpoint** (not yet used): `https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json`
  — confirmed via a live test fetch to return, per record:
  ```json
  {
    "OBJECT_NAME": "CALSPHERE 1",
    "OBJECT_ID": "1964-063C",
    "NORAD_CAT_ID": 900,
    "OBJECT_TYPE": "PAY",
    "OPS_STATUS_CODE": "+",
    "OWNER": "US",
    "LAUNCH_DATE": "1964-10-06",
    "PERIOD": 104.6,
    "INCLINATION": 90.22,
    "APOGEE": 995,
    "PERIGEE": 956
  }
  ```
  `NORAD_CAT_ID` is the join key back to the GP feed's `NORAD_CAT_ID`.
- **Status code definitions** (`celestrak.org/satcat/status.php`):
  `+`=Operational, `-`=Nonoperational, `P`=Partially operational,
  `B`=Backup/standby, `S`=Spare, `X`=Extended mission, `D`=Decayed, `?`=Unknown.
  CelesTrak's own definition: *"Active is any satellite with an operational
  status of +, P, B, S, or X."* Active status does not require the object to be
  powered/communicating (their example: geodetic satellites).
- **CatalogId / `OBJECT_ID` (COSPAR international designator) is NOT a type or
  status signal.** It's `<launch-year>-<launch-sequence-of-year><piece-letter>`,
  assigned in cataloging order. Verified against launch `1998-067` (ISS): suffix
  `A` = ISS itself, but later multi-letter suffixes (`XH`, `XJ`, `XL`, ...) are
  cubesats deployed from the ISS over the following 25 years, not debris or
  rocket bodies. Suffix position = cataloging sequence, nothing else.

## Usage-policy constraints (from `celestrak.org/usage-policy.php`, fetched directly)

- GP data: download **no more than once every 2 hours**.
- SATCAT: **"updates manually once or twice a day"**; check the directory
  endpoint no more than **once per hour**, but there is no benefit to polling
  faster than SATCAT's own update cadence.
- "Only download the data you need, when you are going to use it, and only
  download data once per update." Avoid redundant/bulk re-fetches.
- Machine clients must **stop immediately on non-200 responses**: 301 (stale
  URL — update the query), 404 (client badly out of date), 50x (server
  overloaded — back off). Repeated violations risk an IP-level firewall block.
- No attribution/registration requirement stated.
- CelesTrak explicitly named the "Active list for GP data" and, imminently,
  "SATCAT" as datasets they are beginning to rate-limit-enforce.

**Current actual cadence**: neither `.github/workflows/pages.yml` (deploys on
push only) nor `.github/workflows/validation.yml` (syntax/fixture checks on
push/PR) ever invoke `fetch_celestrak.mjs`. There is no `schedule:` trigger
anywhere in `.github/workflows/`. The script is run manually/on-demand and its
output committed once — compliant by construction (no automated polling exists
yet), but stale until someone reruns it by hand.

## Decided color mapping (Option A — confirmed with user)

Coordinated against the **existing, unchanged** Legend in `index.html`
(`origin/master` lines 66-74):

```html
<li style="color: DarkOrange;">Active satellite</li>
<li style="color: cyan;">Inactive satellite</li>
<li style="color: MediumOrchid;">Rocket body</li>
<li style="color: gray;">Debris</li>
<li style="color: DeepPink;">Uncategorized</li>
<li style="color: Gold;">Status unavailable</li>
```

Final per-row classification for CelesTrak-sourced rows once `ObjectType` and
`OpsStatusCode` are populated:

1. `ObjectType == "DEB"` → `Cesium.Color.GRAY` ("Debris")
2. `ObjectType == "R/B"` → `Cesium.Color.MEDIUMORCHID` ("Rocket body") — **correction**:
   CelesTrak SATCAT's `OBJECT_TYPE` uses abbreviated codes (`PAY`, `R/B`, `DEB`, `UNK`),
   not spelled-out names; confirmed against real fetched data (`PAY` 16,274, `R/B` 2)
   before implementing PR2, and verified live in-browser via `ObjData`/entity color
   inspection (SL-4 R/B, NORAD 68753 → `rgb(186,85,211)` = MediumOrchid, correctly
   overriding what would otherwise be DarkOrange since its `OpsStatusCode` is `+`).
3. `OpsStatusCode` in `{+, P, B, S, X}` → `Cesium.Color.DARKORANGE` ("Active
   satellite") — matches CelesTrak's own published "active" definition exactly,
   collapsing the finer-grained codes into the existing binary Active/Inactive
   legend rather than inventing a new, visually-confusable shade of orange.
4. `OpsStatusCode == "-"` → `Cesium.Color.CYAN` ("Inactive satellite")
5. `OpsStatusCode == "D"` → skip/hide (decayed; defensive — shouldn't occur in
   the `active` GP feed)
6. `OpsStatusCode` blank/`?`, or non-CelesTrak source (UCS/USSTRATCOM/live API)
   → existing `statusKnown`/`active`/GOLD fallback logic, **unchanged**.

`DeepPink` ("Uncategorized") is untouched — still driven solely by the existing
`JSC Vimpel` (no NoradId) / `SeeSat-L` override.

**No `index.html` legend changes are required under this mapping.** Every color
used already has a correctly-worded legend entry.

Rejected alternative (Option B): a 7th legend color for `P/B/S/X` as a distinct
"partially active" bucket. Rejected because it would require a new legend entry
and a genuinely distinct hue (not a shade of orange, which would be visually
confusable with DarkOrange).

## Implementation plan

### PR1 — Fetch script + schema (no visual/behavior change)

Files: `scripts/fetch_celestrak.mjs`, `assets/data/www_query_NODEB.tsv`,
`assets/data/www_query_DEB.tsv`, `.github/workflows/validation.yml`,
`scripts/test_celestrak.mjs`

- Add one additional fetch: `https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json`.
  Do **not** add a separate SATCAT call for the two debris groups
  (`iridium-33-debris`, `cosmos-2251-debris`) — their `ObjectType` is already
  implied by group membership, and a 4th HTTP call would violate "only
  download the data you need."
- Build a `Map<NORAD_CAT_ID, satcatRecord>` from the SATCAT response.
- Extend `rowFromCelestrak(obj, satcatByNoradId)` to look up the GP record's
  `NORAD_CAT_ID` in that map and, when found, populate:
  - `BirthDate` ← `LAUNCH_DATE` (currently always blank)
  - `Operator` ← `OWNER` (currently always blank)
  - two **new trailing** TSV columns: `OpsStatusCode`, `ObjectType`
    (append-only — keeps existing column positions stable so `main.js`'s
    index-based `NumFields`/`InfoFields` arrays don't silently break)
  - On a join miss (NORAD ID in GP-active but not in SATCAT-active), leave the
    new/backfilled fields blank — never throw.
- Update `.github/workflows/validation.yml`'s inline TSV shape check
  (currently hardcoded `width !== 25`) to the new column count, in the **same
  PR** as the header change — do not let these drift apart.
- Extend the existing "stop on non-200" handling (currently wraps only the
  debris-group GP calls) to the new SATCAT call identically: 301/404/50x →
  log, abort the run without publishing, no retry loop.
- Extend the existing transactional `publishPair` staged-write/rollback
  pattern to cover the SATCAT-derived columns so a partial failure can't
  commit a mismatched TSV pair.
- Add fixtures to `scripts/test_celestrak.mjs`: SATCAT fetch failure (GP data
  must still publish, new columns just stay blank — graceful degradation,
  same pattern already used for debris-group failures), a join-miss case, and
  an unrecognized `OPS_STATUS_CODE` value (defensive parsing).
- Regenerate the committed TSVs once, diff row-for-row against current
  checked-in files to confirm no previously-populated column goes blank and
  row counts match.

### PR2 — Color mapping (depends on PR1 merged)

Files: `main.js`

- Implement the "Decided color mapping" section above in `DisplayObjects`.
- Surface `OpsStatusCode` and `ObjectType` in the click-popup
  (`DisplayOrbit` / `InfoFields`) so the mapping is auditable per-object in
  the UI, not just implied by dot color.
- No `index.html` changes needed (mapping was coordinated against the
  existing Legend text — see above).
- Manual verification: load `index.html` locally against PR1's regenerated
  TSVs (`UseLocalData` path), confirm color distribution shifts away from
  "predominantly GOLD" to a DarkOrange/Cyan/Gray/MediumOrchid mix; spot-check
  a known object (e.g. ISS, NORAD 25544) via the popup panel for correct
  `OpsStatusCode`/color.

### PR3 — Scheduled refresh (depends on PR1+PR2 merged and manually validated)

Files: new `.github/workflows/refresh-data.yml`

- `on: schedule` cron, recommended every 12 hours (satisfies both the GP 2h
  floor and SATCAT's own ~1-2x/day update cadence with margin — polling
  faster than SATCAT itself updates is waste, not compliance), plus
  `workflow_dispatch` for manual triggering.
- `concurrency:` guard so overlapping scheduled runs can't double-fetch.
- Steps: checkout, setup Node, run `scripts/fetch_celestrak.mjs`, and if the
  TSVs changed, commit + push to `master` (existing `pages.yml` then deploys
  automatically on that push — no new deploy logic needed).
- Add a small committed metadata file (e.g. `assets/data/.fetch_meta.json`)
  recording per-source fetch timestamps, surfaced in the existing
  `DataModeBadge` UI element so data staleness becomes visible in the UI
  instead of silent.
- Ship this **last**, after PR1+PR2 are proven correct by hand — an automated
  bad fetch should not be able to silently corrupt production before the
  mapping logic itself is validated.

## Rollout sequencing rationale

PR1 → PR2 → PR3 in strict order because each depends on the previous:
PR2 needs PR1's new columns to exist in committed data before the color logic
has anything to consume; PR3 automates a pipeline that should only run
unattended once PR1+PR2 have been manually verified correct. This also keeps
each PR independently reviewable and revertable — PR1 alone is a pure
data-completeness change with zero visual effect, low risk to merge on its own.

## Cross-tool handoff notes

- This file is the durable source of truth — not any single assistant's chat
  history or session-local task list. Any tool (Claude Code, Codex, a local
  LLM) resuming this work should start by reading this file, then check
  `docs/plans/celestrak-satcat-status-worklog.md` (same directory) for the
  latest status, then re-verify current git/branch state before acting — do
  not trust either file's claims about "current" repo state without
  re-checking `git log`/`git status`, since they can go stale.
- A duplicate copy of this file and its worklog live in
  `~/Projects/claude-plans/` for tools that don't have this worktree checked
  out yet. That copy is a **reference/discovery** copy — the copy inside this
  worktree (`docs/plans/celestrak-satcat-status.md`) is the one that should
  actually be edited as work progresses, then re-synced to
  `~/Projects/claude-plans/` afterward, since only the in-repo copy travels
  with the branch through commits/PRs.
- Worktree: `/Users/paulhugel/Projects/_WORKTREES/AstriaGraph/celestrak-satcat-status`
  Branch: `claude/celestrak-satcat-status`, tracking `origin/master`
  (cut from `9f753c0`, confirmed current via `git fetch` at creation time).
