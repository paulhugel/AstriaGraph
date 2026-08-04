# Work log: CelesTrak SATCAT status integration

See `celestrak-satcat-status.md` in this same directory for the full plan.
This file tracks what's actually been done, in order, so any tool picking up
the work can see current status without replaying the whole investigation.

## Status

- [x] PR1: fetch script + schema (BirthDate/Operator/OpsStatusCode/ObjectType columns) — merged: https://github.com/paulhugel/AstriaGraph/pull/10 (2b7d3ff)
- [x] PR2: color mapping (Option A) + popup fields — implemented, verified live in-browser, PR opened: https://github.com/paulhugel/AstriaGraph/pull/11 (CI green)
- [ ] PR3: scheduled refresh workflow (12h cadence)

## Log

### 2026-08-03 — Investigation + planning (Claude Code)

- Diagnosed why `www_query_NODEB.tsv`-sourced objects render mostly GOLD on
  the live GitHub Pages site: `DataSource` resolves to `"CelesTrak"`, which
  the `statusKnown`/`active` classification in `main.js` doesn't recognize
  (only checks `"UCS"`/`"USSTRATCOM"`). Confirmed by reading `origin/master`
  directly, not the (stale) local main checkout.
- Found a **second**, independent issue: `scripts/fetch_celestrak.mjs` never
  fetches or forwards an operational-status field at all — CelesTrak's GP feed
  (`gp.php?GROUP=active`) doesn't carry one; that lives in the separate SATCAT
  feed (`satcat/records.php?GROUP=active`), confirmed via a live test fetch.
- Confirmed `CatalogId` (COSPAR designator) suffix is not a type/status signal
  — verified against the ISS launch (`1998-067`), where later multi-letter
  suffixes are cubesats deployed from ISS over 25 years, not debris.
- Read CelesTrak's usage policy directly (`WebFetch`, not memory): GP data
  ≤ once/2h, SATCAT updates 1-2x/day and should be checked ≤ once/hr, stop
  immediately on non-200. Confirmed neither `pages.yml` nor `validation.yml`
  actually runs `fetch_celestrak.mjs` on any schedule today — no automated
  polling exists yet, so current cadence is compliant by construction (fully
  manual), just stale.
- Verified CelesTrak's own operational-status definitions
  (`celestrak.org/satcat/status.php`): `+/-/P/B/S/X/D/?`, and that "active"
  (per CelesTrak) means `{+, P, B, S, X}`, not just `+`.
- Proposed and the user confirmed **Option A** for color mapping: collapse
  `{+, P, B, S, X}` → DarkOrange ("Active satellite"), `-` → Cyan ("Inactive
  satellite") — matches CelesTrak's own definition exactly and requires zero
  `index.html` Legend changes (checked the actual Legend markup in
  `origin/master` before finalizing, rather than assuming).
- Wrote the full plan to `docs/plans/celestrak-satcat-status.md` (this
  worktree) plus a duplicate to `~/Projects/claude-plans/`.

### Process note — worktree/checkout mixup (corrected)

Mid-conversation, an edit intended for the assigned worktree
(`.claude/worktrees/color-assignment-nodeb-a1716f`) was accidentally applied
to the main checkout (`/Users/paulhugel/Projects/AstriaGraph`, branch
`master`) instead, due to an absolute `cd` to the wrong path. That checkout
also has unrelated pre-existing uncommitted changes (not from this work) —
possibly from another active session, given `codex/astria-debris-fetch-safety`
and `codex/astria-error-fixes` worktrees already exist for closely related
areas of this codebase. The stray edit was identified and flagged to the user;
by user instruction the conversation continued read-only from that point
until the new worktree below was created. **Any tool resuming this work should
verify `git status` in whichever worktree it lands in before assuming it's
clean**, and should not touch the main checkout's unrelated dirty state.

### 2026-08-03 — PR1 implemented (Claude Code)

Before implementing, re-read `main.js` fresh in this worktree rather than
trusting the earlier `origin/master` read from earlier in the conversation —
`origin/master` had moved (now includes `UseStaticFallback`/
`ValidateTsvResponse`/`ValidateDataSourceResponse`/`StartDataLoad`, likely
from the other active `codex/*` worktrees). Confirmed the root-cause finding
still holds: `DisplayObjects`' `statusKnown`/`active` classification still
only recognizes `DataSource == "UCS"` or `"USSTRATCOM"`, so CelesTrak rows
(`DataSource == "CelesTrak"`) still fall through to GOLD. PR1 does not touch
`main.js` — that's PR2, scoped separately as planned.

Changes made, all in this worktree:

- `scripts/fetch_celestrak.mjs`:
  - Added `fetchSatcatActiveMap()` — fetches
    `https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json`,
    returns a `Map<String(NORAD_CAT_ID), record>`. On any failure (non-200,
    non-array response, etc.) logs a warning and returns an **empty** Map
    rather than throwing — SATCAT enrichment is best-effort and must not
    block NODEB/DEB publication, per the plan.
  - `HEADER` gets two new trailing columns: `OpsStatusCode`, `ObjectType`
    (append-only, existing column positions unchanged).
  - `rowFromCelestrak(obj, satcatByNoradId)` now joins on NORAD_CAT_ID and
    populates `BirthDate`/`Operator`/`OpsStatusCode`/`ObjectType` when a
    SATCAT match exists; blank on a join miss (not an error).
  - `main()`: fetches the SATCAT active map once, passes it only to the
    NODEB (active) row mapping — debris rows are NOT SATCAT-enriched
    (deliberate, per plan: their type is already implied by group membership,
    and a 3rd SATCAT call would be an unnecessary extra request under the
    usage policy's "only download what you need" guidance).
- `.github/workflows/validation.yml`:
  - Bumped the hardcoded TSV width check from 25 to 27.
  - **Found and fixed a real bug** exposed by the schema change: the
    validator did `fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/)`,
    and `trimEnd()` on the whole file blob strips trailing whitespace —
    including tab characters. Since debris rows now legitimately end in two
    *empty* tab-delimited columns (no SATCAT enrichment for debris), and the
    file has no final newline, the last row's trailing `\t\t` sat right at
    EOF and got eaten, producing a 25-cell "malformed row" false positive on
    real data. Fixed by splitting first and filtering only genuinely empty
    lines, instead of trimming the raw blob. Verified by running the
    validator inline against the regenerated files before and after the fix
    (failed on `www_query_DEB.tsv` before, passed after).
- `scripts/test_celestrak.mjs`: added fixtures for join-hit, join-miss,
  partial-SATCAT-record (defensive per-field fallback), and three
  `fetchSatcatActiveMap()` failure-mode tests (HTTP 500, malformed non-array
  response, and a successful-response shape check) using a stubbed
  `global.fetch` — no live network dependency for the test suite itself.

Verification performed:

- `node --check main.js` / `node --check scripts/fetch_celestrak.mjs` — pass
- `node scripts/test_celestrak.mjs` — pass (all fixtures, including the new
  SATCAT ones)
- Ran `scripts/fetch_celestrak.mjs` for real against live CelesTrak
  (network reachable from this environment): **16,276** active rows,
  **705** debris rows. `OpsStatusCode` join coverage was **100%** for the
  active set (16,276/16,276 rows got a real code) — distribution: `+` 15,736,
  `P` 502, `B` 23, `X` 9, `S` 6. `ObjectType`: `PAY` 16,274, `R/B` 2 (two
  rocket bodies present in CelesTrak's own "active" group — a real quirk of
  their curation, not a bug in this fetch). No unrecognized status codes
  appeared.
- Ran the (fixed) validation.yml inline TSV check against the regenerated
  files directly — both pass.

**Not yet done**: nothing has been committed or pushed. Working tree in this
worktree currently has the above changes uncommitted, awaiting explicit
go-ahead to commit (per the session's standing git-safety rule: only commit
when the user explicitly asks).

### 2026-08-03 — PR targeting mistake, corrected

`gh pr create` (no `--repo` flag) defaulted to this checkout's `upstream`
remote (`ut-astria/AstriaGraph`) rather than `origin`
(`paulhugel/AstriaGraph` — the fork that actually deploys the live site at
paulhugel.github.io/AstriaGraph), because `gh repo view` resolves the
directory's default repo to `ut-astria/AstriaGraph`. This produced an
unwanted cross-repo PR against a different organization's upstream repo
(`ut-astria/AstriaGraph#2`, head `paulhugel:claude/celestrak-satcat-status`
→ base `ut-astria:master`). Caught immediately, confirmed via
`gh pr view --json headRepositoryOwner,isCrossRepository`, closed with an
explanatory comment, and re-opened correctly with an explicit `--repo
paulhugel/AstriaGraph` flag: **paulhugel/AstriaGraph#10**.

**Lesson for future PRs on this repo/worktree**: always pass
`--repo paulhugel/AstriaGraph` explicitly to `gh pr create` (and `gh pr
view`/`gh pr close` etc.) rather than relying on the ambient default repo,
since this checkout has both `origin` (paulhugel/AstriaGraph) and `upstream`
(ut-astria/AstriaGraph) remotes and `gh`'s default resolves to `upstream`.

### 2026-08-04 — CI failure fixed (Claude Code)

PR1's `validate` check failed on push: not a data problem, a **shell syntax
error**. The "Validate checked-in TSV datasets" step wraps its `node -e`
script in a single-quoted bash string (`run: | node --input-type=module -e
'...'`). The explanatory comment added in the trimEnd()-fix commit contained
an apostrophe (`row's`), which terminated that bash single-quoted string
early mid-script and broke the shell parse — CI error was `syntax error near
unexpected token '('`, not any assertion failure. Confirmed by pulling the
actual failed-step log via `gh run view --log-failed` rather than assuming;
reproduced the exact failure locally with the same `bash -c` wrapping before
fixing, and reproduced success the same way after. Reworded the comment to
avoid apostrophes entirely, re-ran `node --check`/`node scripts/test_celestrak.mjs`
locally, committed (6f49a56), pushed, and confirmed `gh pr checks 10 --repo
paulhugel/AstriaGraph` now reports `validate: pass`.

**Lesson**: any inline comment or string added inside a YAML `run: |` block
that itself contains a single-quoted shell string must avoid apostrophes (or
any character that terminates that quoting), not just be syntactically valid
in the target language (JS) alone — the outer shell quoting is a second,
easy-to-miss constraint. Worth a local `bash -c "<exact run: block content>"`
smoke test before pushing any future edit to this step.

### 2026-08-04 — PR1 merged

Confirmed clean/mergeable/CI-green via `gh pr view 10 --repo
paulhugel/AstriaGraph`, then `gh pr merge 10 --repo paulhugel/AstriaGraph
--merge` (merge commit, matching this repo's existing "Merge PR #N: ..."
convention). Merged as `2b7d3ff`. Verified by fetching `origin/master` and
re-reading the committed `www_query_NODEB.tsv` header directly — the 27-column
schema with `OpsStatusCode`/`ObjectType` is now live on `master`.

Cut a fresh worktree for PR2 off the newly-merged `origin/master`, per the
plan's sequencing (PR2 needs PR1's columns to exist in committed data):
`/Users/paulhugel/Projects/_WORKTREES/AstriaGraph/celestrak-color-mapping`,
branch `claude/celestrak-color-mapping`.

### 2026-08-04 — PR2 implemented (Claude Code)

Re-read `main.js`'s current `DisplayObjects` fresh in the new worktree before
editing (same discipline as PR1 — don't trust an earlier read of a moving
target). Confirmed the GOLD-default bug described in the plan still exactly
applies pre-PR2.

**Correction to the plan caught before implementing**: the plan doc said
`ObjectType == "ROCKET BODY"`, but CelesTrak SATCAT's actual `OBJECT_TYPE`
field uses abbreviated codes. Checked the real merged data
(`assets/data/www_query_NODEB.tsv` on the new worktree, already containing
PR1's output): `PAY` (16,274 rows), `R/B` (2 rows) — no spelled-out names.
Implemented against `"R/B"`, not `"ROCKET BODY"`, and corrected the plan doc
to match.

Changes made, `main.js` only:

- `DisplayObjects`: added a `trk["DataSource"] == "CelesTrak" &&
  trk["OpsStatusCode"]` branch ahead of the legacy `statusKnown`/`active`/GOLD
  cascade, implementing the finalized Option-A mapping (DEB→Gray,
  R/B→MediumOrchid, `{+,P,B,S,X}`→DarkOrange, `-`→Cyan, `D`→skip). The legacy
  branch (and its Name-substring R/B/DEB overrides) is now only reached for
  non-CelesTrak rows or CelesTrak rows without SATCAT enrichment, avoiding any
  double-application of the two classification schemes on the same row. The
  `DeepPink` (JSC Vimpel/SeeSat-L) override still applies unconditionally
  afterward, as before — it can't match `DataSource == "CelesTrak"` anyway.
- `InfoFields`: added `"OpsStatusCode"`, `"ObjectType"` so the click-popup
  surfaces them (no other change needed — existing generic rendering loop
  already handles arbitrary string fields).
- **Found and fixed a real bug while doing this**: `InfoFields.forEach`'s
  `if (same[inf].length > 0)` throws `TypeError` when `same[inf]` is
  `undefined` — which it now is for `OpsStatusCode`/`ObjectType` on any row
  whose source TSV/API doesn't include those columns (specifically, the live
  `ApiBase` backend, untouched by PR1, almost certainly doesn't yet). This
  would have broken the popup entirely in live-API mode. Fixed to
  `if (same[inf] && same[inf].length > 0)`.

Verification performed:

- `node --check main.js` — pass
- `node scripts/test_celestrak.mjs` — pass (unaffected by this PR, data-layer
  tests only; no main.js color-logic unit tests exist in this codebase's
  convention — verified via live browser instead, see below)
- Served the worktree with `python3 -m http.server` via `preview_start`
  (`.claude/launch.json` written to the *other*, unrelated worktree that
  hosts this session — Browser-pane tooling resolves launch.json from the
  session's own working directory, not arbitrary paths — cleaned up
  afterward, confirmed via `git status` it left no trace in either worktree)
  and loaded `index.html` in the real browser:
  - Visual: color distribution flipped from the pre-PR2 "predominantly GOLD"
    to predominantly DarkOrange, as intended. No console errors.
  - Searched "ISS (ZARYA)" (NORAD 25544): popup correctly showed
    `Data Source: CelesTrak`, `OpsStatusCode: +`, `ObjectType: PAY`; rendered
    DarkOrange as expected.
  - Used `javascript_tool` to directly inspect `ObjData`/entity color for
    NORAD 68753 ("SL-4 R/B", one of the two real `R/B`-typed rows in the
    dataset): confirmed `OpsStatusCode: "+"`, `ObjectType: "R/B"`, and actual
    rendered entity color `rgb(186,85,211)` — exactly MediumOrchid — proving
    the `ObjectType` check correctly overrides what would otherwise be
    DarkOrange from `OpsStatusCode` alone. This is the strongest evidence the
    priority ordering in the plan is implemented correctly, not just
    plausible-looking code.
  - Did not find a real `OpsStatusCode == "-"` example in the current active
    snapshot to visually confirm Cyan (none exist in this pull — CelesTrak's
    "active" group is overwhelmingly `+`; see PR1's log for the full status
    distribution). The code path is a single equality check, low risk, not
    independently confirmed against real data.

**Not yet done**: nothing committed or pushed for PR2 yet.

Committed (e5de9af), pushed, PR opened with `--repo paulhugel/AstriaGraph`
passed explicitly from the start this time (lesson from PR1 applied) — no
repo-targeting mistake. CI (`validate`) passed on the first push.

### 2026-08-04 — Debris/rocket-body loading verified live (Claude Code)

User asked to specifically confirm rocket bodies and debris load and render
correctly (the `www_query_DEB.tsv` path, gated behind the "Display rocket
bodies and debris" checkbox, `OnToggleDebris`/`DebrisLoaded` in `main.js`).
Re-served this worktree, loaded in browser, confirmed via network requests
that both `www_query_NODEB.tsv` and `www_query_DEB.tsv` returned 200, and
inspected `ObjData`/entity colors directly via `javascript_tool`:

- `ObjData` total = 16,981 = 16,276 (NODEB) + 705 (DEB) exactly — confirms
  the debris file fully loaded into the same object store.
- 703 objects with `"DEB"` in `Name` → all 703 render exactly Gray
  (`rgb(128,128,128)`).
- 5 objects with `"R/B"` in `Name` split 2 MediumOrchid / 3 DarkOrange — at
  first glance looked like 3 miscolored rocket bodies, but investigated and
  it's correct: the 3 DarkOrange ones (`CELESTIS-02 & TAURUS R/B`, `RS-44 &
  BREEZE-KM R/B`, `IPM 2 & BREEZE-M R/B`) are payload+upper-stage combo
  objects that CelesTrak's own SATCAT classifies `ObjectType: "PAY"` — the
  string `"R/B"` only appears in the descriptive name, not the
  classification. PR2's `ObjectType`-priority design is working exactly as
  intended here: it correctly ignores the misleading Name substring in favor
  of SATCAT's authoritative type, which the old legacy Name-only heuristic
  could not do (it would have miscolored these three).
- No console errors.

### Next step

PR2 (paulhugel/AstriaGraph#11) is open, CI passing, awaiting review/merge.
After merge, PR3 (scheduled refresh workflow, cadence ~12h) is last — see
`celestrak-satcat-status.md`. Remember `--repo paulhugel/AstriaGraph`
explicitly for any `gh` command in whatever worktree does PR3.
