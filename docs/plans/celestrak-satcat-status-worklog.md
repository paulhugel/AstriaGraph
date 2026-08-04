# Work log: CelesTrak SATCAT status integration

See `celestrak-satcat-status.md` in this same directory for the full plan.
This file tracks what's actually been done, in order, so any tool picking up
the work can see current status without replaying the whole investigation.

## Status

- [x] PR1: fetch script + schema (BirthDate/Operator/OpsStatusCode/ObjectType columns) — implemented, not yet committed/pushed
- [ ] PR2: color mapping (Option A) + popup fields
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

### Next step

Commit PR1 (pending explicit user go-ahead), then open a PR against
`origin/master` from branch `claude/celestrak-satcat-status`. After merge,
start PR2 (color mapping in `main.js`) — see `celestrak-satcat-status.md`.
