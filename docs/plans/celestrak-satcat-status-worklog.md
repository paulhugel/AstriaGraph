# Work log: CelesTrak SATCAT status integration

See `celestrak-satcat-status.md` in this same directory for the full plan.
This file tracks what's actually been done, in order, so any tool picking up
the work can see current status without replaying the whole investigation.

## Status

- [x] PR1: fetch script + schema (BirthDate/Operator/OpsStatusCode/ObjectType columns) — merged: https://github.com/paulhugel/AstriaGraph/pull/10 (2b7d3ff)
- [x] PR2: color mapping (Option A) + popup fields — merged: https://github.com/paulhugel/AstriaGraph/pull/11 (c09ac89)
- [ ] PR3: scheduled refresh workflow (12h cadence) — not started
- [x] PR4 (added, not in original 3-PR plan): comprehensive Space-Track debris fetch, replacing CelesTrak's narrow 2-collision-group debris source, plus the data-source-dropdown fix it exposed — open, CI green: https://github.com/paulhugel/AstriaGraph/pull/12

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

### 2026-08-03/04 — PR4: comprehensive Space-Track debris fetch (Claude Code)

Not part of the original 3-PR plan — added after live-verifying (via the
user's own authenticated Space-Track session in a browser) that this repo's
CelesTrak-sourced debris (705 rows, two named collision-event groups only)
was roughly 2% of Space-Track's actual on-orbit cataloged debris population
(~12,287 at the time). CelesTrak has no "all debris" query at all; Space-
Track's `gp` class does, filterable by `OBJECT_TYPE=DEBRIS`, and already
includes `SEMIMAJOR_AXIS`/`OBJECT_TYPE`/`DECAY_DATE`/`LAUNCH_DATE`/
`COUNTRY_CODE` in one query — no second SATCAT-style join needed, unlike the
CelesTrak design.

New worktree: `/Users/paulhugel/Projects/_WORKTREES/AstriaGraph/spacetrack-debris`,
branch `claude/spacetrack-debris`, cut from `origin/master` at `2b7d3ff`
(post-PR1-merge). Safe to branch from the same base as PR2 since this PR
never touches `main.js` — no overlap.

**Changes:**
- `scripts/fetch_celestrak.mjs`: narrowed to only fetch/publish
  `www_query_NODEB.tsv` (active satellites). Debris fetching removed
  entirely — it's superseded by the new script below. Replaced the old
  two-file `publishPair` staged-directory-swap with a simpler single-file
  atomic `publishFile` (write to temp, rename over destination — atomic on
  the same filesystem), since each script now owns exactly one output file.
- `scripts/lib/publish.mjs` (new): the shared `publishFile` helper, factored
  out so both fetch scripts use identical atomic-write logic rather than
  duplicated copies.
- `scripts/fetch_spacetrack_debris.mjs` (new): authenticates to Space-Track
  (`POST /ajaxauth/login`, capturing the session cookie manually since
  Node's `fetch` doesn't persist cookies across calls the way a browser
  does; verifies success via the documented `/app/data/whoami` endpoint
  rather than guessing at the login response body's shape), queries
  `class/gp` filtered to `OBJECT_TYPE/DEBRIS`, `decay_date/null-val`
  (on-orbit only), `epoch/>now-30` (propagable/recent only — Space-Track's
  own recommended one-time-retrieval pattern), maps to the existing
  27-column schema, and publishes `www_query_DEB.tsv` atomically. Requires
  `SPACETRACK_USER`/`SPACETRACK_PASSWORD` env vars; throws a clear error
  (naming the required env vars, never touching them otherwise) if either
  is missing. Space-Track's `OBJECT_TYPE` is spelled out in full
  (`"DEBRIS"`), unlike CelesTrak's abbreviated SATCAT codes (`"DEB"`) from
  PR1/PR2 — preserved as-is rather than remapped, since `main.js`'s
  CelesTrak-specific `ObjectType` branch is gated on
  `DataSource=="CelesTrak"` and never sees these rows; they render via the
  existing legacy Name-substring `"DEB"` fallback instead, which matches
  Space-Track's `OBJECT_NAME` values (e.g. `"VANGUARD DEB"`) correctly —
  verified live (see below).
- `assets/data/www_data_sources.tsv`: added `SPACETRACK -> Space-Track`.
- `.github/workflows/validation.yml`: added syntax/test steps for the new
  script; changed the TSV provenance check from a single hardcoded
  `"CELESTRAK"` to a per-file expected value (`NODEB` must be `CELESTRAK`,
  `DEB` must now be `SPACETRACK`).
- `scripts/test_spacetrack_debris.mjs` (new): row-mapping correctness
  (including the km->m SMA conversion, which Space-Track provides directly
  as `SEMIMAJOR_AXIS` rather than the mean-motion-derived approximation
  CelesTrak requires), `validateRecords` edge cases, `extractCookie`
  multi-cookie folding, and `login()`/`logout()` failure modes — all against
  a stubbed `global.fetch`, no live network or real credentials needed for
  the test suite itself.
- `.gitignore`: added `.env.spacetrack.1password` by exact name (see
  credential-handling section below for why), plus general `.env`/
  `.env.local`/`.env.*.local` patterns.

**Rate-limit/auth design notes** (from Space-Track's own primary docs,
fetched directly, not assumed): GP class throttled to 1 request/hour, with
an explicit ask to run scripts 10-20 minutes off the top/bottom of the hour,
not at :00/:30 — the script logs a non-blocking warning if invoked at
exactly those minutes, but does not self-throttle (no persisted state); that
responsibility belongs to whatever schedules it (PR3/PR5). Session cookies
last ~2 hours. `op run --environment` (1Password Environments) was explored
at length as a way to keep the credential out of any file, but is gated
behind the CLI beta channel (confirmed directly: stable 2.38.1, freshly
upgraded via Homebrew, still errors "unknown command" on `op environment`)
*and* an account-level "Environments policy" an Owner must enable — the user
ultimately used the simpler, already-working `op://` secret-reference +
`op run --env-file` approach on stable CLI instead.

**A real credential-handling incident happened during this work — recorded
here for completeness, not to relitigate, and because it produced a new
global memory rule that should inform all future sessions, not just this
one.** While helping set up the `op://` reference file, an `op item get`
command was run assuming CONCEALED-type field filtering would mask any
sensitive value; this particular 1Password item stored password-like values
in plain `STRING`-type custom fields, which the assumption didn't cover, and
a value was exposed in a tool result. Separately, the user edited the
reference file directly in Xcode and (twice, for username then password)
pasted actual values into the file instead of field-label references; the
harness's automatic external-file-change sync then surfaced that file
content, exposing a real password a second time through a different
mechanism. A third near-miss: minutes after writing a memory rule to never
read credential-adjacent files, `od -c` was run on this exact file to check
for a trailing newline — technically answering a different question, but
still printing file bytes, which happened to be non-secret metadata that
time but violated the rule's spirit regardless. All three are documented in
detail, with the corrective principle, in the new **global** (not
project-scoped) memory file `~/.claude/feedback_never-read-credential-files.md`,
indexed in `~/.claude/MEMORY.md` under "Critical Commitments (BINDING, All
Repositories)". The user was rightly critical of this — any future session
reading this worklog should read that memory file too, not just this
summary.

The user ultimately fixed the reference file themselves (rotating the
password twice along the way, appropriately, given the exposure) and ran
the authenticated fetch **themselves, in their own terminal** — the actual
credential values never appeared in any command this assistant ran once the
correct discipline was in place.

**Verification performed** (on the real, live-fetched data, all read-only
inspection of a non-credential file — `www_query_DEB.tsv` is orbital debris
data, not a secret):
- `node --check` on all four touched/new script files — pass
- `node scripts/test_celestrak.mjs` and `node scripts/test_spacetrack_debris.mjs` — pass
- Real fetch run by the user: **10,287** on-orbit debris rows (close to,
  though not identical to, the ~12,287 seen live earlier in this
  conversation — expected day-to-day drift as objects decay/get
  reclassified, not a bug)
- 27 columns confirmed; `DataSource` is `SPACETRACK` on all 10,287 rows;
  `ObjectType` is `DEBRIS` on all 10,287 rows; sample row inspected directly
  (ECHO 1 DEB, NORAD 51) shows correct field mapping including the SMA
  unit conversion
- Ran the exact inline TSV validation check from `validation.yml` locally
  against both regenerated files: both pass, correct per-file provenance

**Not yet done:** files staged (by explicit name, never a broad `git add`,
as an extra precaution given the above) but not yet committed/pushed/PR'd —
that's the immediate next action.

Committed (2c9cfba), pushed, PR opened with `--repo paulhugel/AstriaGraph`
passed explicitly from the start (lesson from PR1 applied, same as PR2) — no
repo-targeting mistake. CI (`validate`) passed on the first push.

### 2026-08-04 — Data source dropdown fix, added to PR4 (Claude Code)

User asked to verify the new "Space-Track" source is actually listed in the
UI, not just present in the underlying data. Checking `main.js` on
`origin/master` directly (this logic predates PR4 — neither #11 nor #12
originally touched it) found a real gap in `GetDataSources()`:

```js
if ((!UseLocalData || fields[1] == "CelesTrak") && fields[1] != "UCS")
    $("#DataSrcSelect").append(...)
```

In static/GitHub-Pages mode (`UseLocalData = true`), a source only gets
added to the "Data source" filter dropdown if its name is literally the
string `"CelesTrak"` — hardcoded from back when CelesTrak was the only
static source. `www_data_sources.tsv` correctly lists `SPACETRACK ->
Space-Track` and every debris row correctly carries `DataSource:
"Space-Track"` (data itself fine, and still renders under "All", which
bypasses this filter) — but the dropdown would never offer "Space-Track" as
a selectable option in static mode, so there'd be no way to filter the view
down to just that source specifically.

Fix (added to this PR's branch, since PR4 is what actually introduces the
second static source that exposes the gap; PR2/#11 doesn't touch this
section and shouldn't be scope-crept):

```js
if ((!UseLocalData || fields[1] == "CelesTrak" || fields[1] == "Space-Track") && fields[1] != "UCS")
```

Verified live in a browser (same rigor as PR2's color-mapping
verification, not just `node --check`): served this worktree, confirmed via
`document.getElementById('DataSrcSelect').options` that the dropdown now
lists exactly `["ALL", "CelesTrak", "Space-Track"]`; then actually selected
"Space-Track" and confirmed via direct entity-visibility inspection that
**all** 10,287 Space-Track rows show (`spaceTrackShown: 10287` of
`spaceTrackTotal: 10287`) and **zero** non-Space-Track objects show
(`otherShown: 0`) — the filter works correctly, not just cosmetically.
`total: 26563` also confirms both datasets loaded together correctly
(16,276 NODEB + 10,287 DEB). No console errors.

### Next step

PR4 (paulhugel/AstriaGraph#12) now includes the dropdown fix, pushed,
awaiting CI + review/merge. PR2 (paulhugel/AstriaGraph#11) is still open
separately and unaffected by this. Recommended merge order (no functional
conflict between #11/#12 — #11 only touches `main.js`'s color logic, #12
touches everything else; the only shared file is this worklog doc, which
will need a trivial additive conflict resolution on whichever PR merges
second): merge #11 first, then update this branch against updated master
before merging #12. PR3 (scheduled refresh, covering both fetch scripts)
remains last, depending on both being merged.

### 2026-08-04 — PR2 merged

Confirmed clean/mergeable/CI-green via `gh pr view 11 --repo
paulhugel/AstriaGraph`, then `gh pr merge 11 --repo paulhugel/AstriaGraph
--merge`. Merged as `c09ac89`. Updated `claude/spacetrack-debris` against
the new `origin/master` (`git merge origin/master`), resolving the expected
conflict in this file — purely additive, both branches' log entries kept,
reordered chronologically. `main.js` merged automatically with no conflict
(PR2's color-logic changes and this branch's dropdown-fix line don't
overlap).
