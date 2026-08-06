# Mobile-Compatible Redesign — GitHub Pages Site

Status: Design/Planning complete through two independent review rounds (both STOP,
fixes applied); Stage 3 Execution (actual `index.html`/`main.js` changes) **not yet
started**.
Branch: `claude/github-pages-mobile-design-86c554`
Worktree: `/Users/paulhugel/Projects/AstriaGraph/.claude/worktrees/github-pages-mobile-design-86c554`
Base: `master` @ `6424b14` (Merge PR #17: data-sources-popup)

## Problem

`https://paulhugel.github.io/AstriaGraph/` has no mobile layout. Verified live:
`document.querySelector('meta[name="viewport"]')` returns `null`, and
`window.innerWidth`/`document.documentElement.clientWidth` both report ~980px on a
375px-wide mobile viewport — the classic no-viewport-meta desktop-fallback rendering.
Mobile visitors get the full desktop UI shrunk to fit, not a reflowed layout.

## Root causes (confirmed by direct inspection + live browser testing)

1. **No `<meta name="viewport">` tag** in `index.html` at all.
2. **`#InputsDiv`** (`index.html:126-131`) is a fixed 3-column flex row
   (`flex-wrap: nowrap`) — logo/title, search-criteria fieldset, legend fieldset —
   with no breakpoint to reflow on narrow screens.
3. **Zero media queries** anywhere in the inline `<style>` block
   (`index.html:119-249`) — every size is a fixed px/em/pt value.
4. **No resize/matchMedia logic** anywhere in `main.js` (confirmed via grep).
5. **Cesium's native chrome** (`main.js:717-737`: `animation`, `timeline`,
   `homeButton`, `infoBox`, `sceneModePicker`, `navigationHelpButton` all `true`;
   `fullscreenButton` defaults `true`) renders at full desktop size on mobile with
   no adaptation — confirmed via Cesium 1.58's actual `widgets.css` geometry
   (top-right icon cluster ~110-120px wide at `top:5-37px,right:5-125px`; bottom-left
   animation dial 169×112px).
6. **`#DisclaimerDiv`** (`index.html:133-135`) and `.modal-content` (Data Sources
   popup) have no responsive type scaling and can collide with the Cesium widgets
   above on narrow screens.

## Design evolution

### v1 — collapsible search+legend drawer (superseded)

Initial plan: keep desktop layout unchanged, add a mobile-only breakpoint
(`max-width: 768px`) that collapses `#InputsDiv`'s search-criteria and legend
fieldsets behind one shared toggle, collapsed by default. Cesium's native widgets
left untouched ("accept the space cost"). Logo image block flagged for
removal/re-point, later settled: **remove entirely**.

An independent review agent (Stage 4/5 per
`/Users/paulhugel/Projects/multi-phase-authorization-pipeline-standard.md`) returned
**STOP** on this design:

- Drawer's opaque background painted over the "always visible" logo (z-index bug).
- New toggle button geometrically overlapped Cesium's real top-right widget cluster
  (measured, not assumed, from Cesium's own `widgets.css`).
- Disclaimer bar likely collided with the bottom-left animation dial.
- Drawer content stayed in the tab/screen-reader order when visually collapsed.
- Toggle touch target (~30-34px) was under the 44px platform minimum.
- Bundling the color Legend behind the same toggle as search Filters was judged
  likely to under-serve first-time users who need the legend immediately.

### v2 — unified responsive menu (current direction)

Redirected to a much larger scope: **replace Cesium's native chrome entirely** with
one custom, adaptive control system that works identically at every screen size
(no separate mobile/desktop build):

- **Upper-left**: small globe icon + "AstriaGraph" title. Click opens a custom
  time/animation panel (date readout, rewind/play/fast-forward, speed, scrub bar) —
  replacing Cesium's native bottom-left Animation dial.
- **Upper-right**: single "≡" menu icon opening one panel with accordion sections
  **Filter** (search box + Data source/Country of origin/Orbit regime selects +
  debris checkbox, with the color **Legend** folded in), **Sources**, and
  **Disclaimer** (moved off the persistent bottom bar), followed by action rows
  **Reset view** / **Scene mode** / **Full screen** / **Help** (calling the same
  Cesium APIs the disabled native buttons used to), then a **GitHub fork link**.
- Presentation adapts via **CSS container queries** (`@container`), not viewport
  media queries, so the same component works correctly regardless of embedding
  context — demonstrated in the mockup via a width switcher/drag handle.
- `main.js`'s Cesium Viewer config would change: `animation, timeline, homeButton,
  sceneModePicker, navigationHelpButton, fullscreenButton, infoBox` all set `false`,
  with custom menu rows calling `viewer.camera.flyHome()`,
  `viewer.scene.mode = Cesium.SceneMode.*`, `Cesium.Fullscreen.requestFullscreen(...)`.

A second independent review returned **STOP** again, with findings and the fixes
applied in response:

| # | Finding | Fix applied |
|---|---|---|
| 1 | New brand-toggle collided with the real, pre-existing `#DataModeBadge` (z-index 1000) | Merged into one element — small status dot on the globe icon instead of a separate badge |
| 2 | `.menu-panel` had no positional fallback if `@container` is unsupported | Base rule now ships full working drawer positioning directly; `@container` only enhances it |
| 3 | No Escape/click-outside close | Both added; focus returns to the triggering toggle |
| 4 | New sub-44px touch targets (32px time buttons, checkbox row) | All bumped to ≥44px |
| 5 | No spec for menu state after an action fires | Reset view/Full screen/Help auto-close the menu; Scene mode stays open |
| 6 | `infoBox` left out of the "disable native chrome" list | Added to the disable list (entity-detail display deferred/out of scope) |
| 7 | Fullscreen target element unspecified | Documented: targets the whole app container, not just the Cesium canvas |
| 8 | Columbus View silently dropped from Scene mode | Scene mode now cycles all three real modes (3D → 2D → Columbus → 3D) |
| 9 | Rotation/breakpoint transition untested | Mockup got a live drag-resize handle to test the ~460px container-query breakpoint continuously |
| 10 | Legend bundled with Filters, now nested two disclosures deep (worsened) | Reordered — Legend is now the first thing shown when "Filter" opens |

### Round 3 — independent re-check of the v3 fixes

A third independent review verified Round 2's 10 findings against the actual fixed
code (not against the fix table's own claims) and returned **STOP** again, but much
narrower: 8 of 10 were confirmed genuinely resolved. Two Medium findings remained,
both now fixed:

- **Finding A**: the new drag-resize handle (added for Round 2 fix #9) and the new
  outside-click handler (added for Round 2 fix #3) interacted badly — releasing a
  drag fired a synthetic click that the outside-click listener treated as "click
  outside," closing whichever panel was open, breaking the mockup's own demonstrated
  walkthrough. **Fixed**: a `justDragged` flag (cleared on the next tick) and an
  explicit resize-handle exclusion now suppress that synthetic click in the
  outside-click handler.
- **Finding B**: the badge-merge fix (Round 2 #1) was visual-only, with no concrete
  plan for the real `#DataModeBadge` element/its 3 `main.js` call sites. **Resolved
  by specifying the Stage 3 integration plan below** — no mockup code change needed
  for this one, since the real fix is a Stage 3 execution detail, not a mockup gap.

Also confirmed by Round 3: no cascade/specificity bug in the container-query
fallback, the `position:relative`+`overflow:hidden` clipping fix from Round 2 holds
at every tested width, the two panels' mutual-exclusivity behavior is correct, and
`main.js` is verified still completely untouched (no Stage 3 work has started).

### Round 4 — independent validation pass

A fourth review, scoped as a holistic readiness check rather than a re-litigation of
settled findings, independently re-traced the Round 3 `justDragged` fix (confirmed
correct — the synthetic post-drag click is genuinely suppressed regardless of where
the drag ends) and confirmed live git/repo state matches every claim in this doc
exactly (`index.html`/`main.js` byte-identical to base; only this doc has changed).
It also returned **STOP**, on real gaps:

- **Finding 1 (Medium) — a real bug in this doc's own Round 3 badge-integration
  plan**, described and fixed just below.
- **Finding 4 (Low-Medium) — disposition of the old `#InputsDiv`/`#DisclaimerDiv`/
  `.modal` DOM+CSS was unstated.** Fixed — see Settled decisions below.
- **Finding 5 (Low) — the exact breakpoint value validated across all 3 prior
  rounds was never pinned as a requirement.** Fixed — see Settled decisions below.
- Two further items were raised as open **product decisions for the human, not
  planning defects** (not something an independent reviewer should resolve
  unilaterally): whether the mockup's visual re-skin (color tokens, serif brand
  wordmark) is binding for Stage 3 or just structural reference, since the real
  site currently has no custom fonts and uses different named CSS colors; and
  whether the real `<select>` elements — which are jQuery UI `.selectmenu()`
  widgets (`main.js:655,666,677`) generating their own popup DOM, not plain
  `<select>`s — should be swapped to native `<select>` for Stage 3 or kept and
  tested empirically inside the new panel's clip/scroll/transition machinery.
  **Still open** — not resolved by this update; see Open items below.

## Settled decisions

- Logo image + link (`astria.tacc.utexas.edu`) removed entirely.
- Legend folded into the Filter accordion section, shown first.
- One shared toggle for Filter+Sources+Disclaimer+actions+GitHub link (the "≡" menu).
- Time/animation controls collapsed under the brand toggle (upper-left), not a fixed
  bottom-left Cesium dial.
- Cesium's native chrome (`animation, timeline, homeButton, sceneModePicker,
  navigationHelpButton, fullscreenButton, infoBox`) fully disabled and replaced by
  custom menu rows calling the equivalent Cesium APIs.
- One unified design across desktop and mobile via CSS container queries, not a
  binary breakpoint split. **The reviewed and validated breakpoint is a container
  inline-size of 460px**: at ≤460px the menu renders as the full-width drawer
  (the safe base/fallback presentation); at ≥461px it enhances to the compact
  ~280px anchored dropdown. Stage 3 must use this exact value — it's what every
  collision/positioning fix across all 4 review rounds was actually validated
  against; a different number is unreviewed.
- **The whole design must read as responsive, not device-binary, at every real
  screen size** — phones from ~320px up through desktop, portrait and landscape.
  This is the point of the container-query approach (enhancement from one working
  base, not a mobile-build/desktop-build split) and is a hard requirement for
  Stage 3, not just a mockup property: no fixed pixel layout that only "happens to
  work" at the specific widths reviewed (375/520/640) is acceptable — the fluid
  behavior between and beyond those points is what was actually being validated
  via the mockup's drag-resize handle.
- **The old `#InputsDiv`, `#DisclaimerDiv`, `.modal`/`.modal-content` DOM elements
  and their CSS blocks in `index.html` are removed at Stage 3**, not left in place
  hidden or dead — the new unified menu structurally supersedes all of their
  content (search/filter fields, legend, disclaimer text, and the Data Sources
  popup's content move into the new menu's accordion sections).

### Stage 3 integration plan — `#DataModeBadge` (closes Round 3 Finding B — corrected by Round 4 Finding 1)

Confirmed via direct read of the real files: `index.html:23` declares
`<div id="DataModeBadge" title="Data mode"></div>`, styled at `index.html:241-248`
(floating text pill, `z-index:1000`, `.static`/`.live` modifier classes). `main.js`
drives it from exactly 3 call sites (lines 123, 206, 295), each doing
`document.getElementById("DataModeBadge")` then setting `.textContent`,
`.className` (`"static"` or `"live"`), and `.title`.

Decision: **keep the element id and all 3 `main.js` call sites unchanged — zero JS
diff required.** At Stage 3, only `index.html` changes: move the `#DataModeBadge`
div to live inside the new brand-toggle (as a sibling of the brand-mark icon).

**Correction from Round 4 (this was wrong in the original Round 3 fix and would
have shipped a visible regression):** `main.js` sets `badge.className = "static"` /
`"live"` — a full **overwrite** of the class attribute, not an addition. The
mockup's prototype CSS keys off a bare class (`.status-dot{...}
.status-dot.live{...}`), which only worked in the mockup because nothing there
ever changes the dot's class via JS. If Stage 3 copied that pattern literally, the
first time `main.js`'s badge IIFE runs (i.e., on every real page load) it would
overwrite away the `status-dot` class name and strip the dot's base shape/
position/border styling entirely. **The real CSS must key off the element's ID,
exactly like the current, already-working styling does today** —
`#DataModeBadge{ /* dot base: size, position, border */ }
#DataModeBadge.live{ /* color */ }` — not a bare `.status-dot` class selector.
The id never changes, so anchoring to it survives `main.js`'s `className`
overwrites the same way the current pill styling already does.

## Mockups (interactive, published as Claude Artifacts — not part of this repo)

1. v1 collapsible drawer (superseded): `astriagraph-mobile-mockup.html`
2. v2/v3 unified menu (current, post-fixes): `astriagraph-unified-menu-mockup.html`

Both are scratch files outside the repo; they are not committed here and will not
persist beyond the authoring session's local temp directory. This doc is the durable
record of the decisions they demonstrated.

## Open items / next steps

- Round 3 review complete; both findings from it (drag/outside-click conflict,
  badge integration plan) are fixed/documented above.
- Round 4 validation complete; Findings 1, 4, and 5 are fixed/documented above.
- **Two Round 4 items remain genuinely open — human product decisions, not
  planning defects:**
  1. Is the mockup's visual re-skin (dark glass color tokens, `Georgia` serif
     brand wordmark) binding for Stage 3, or is Stage 3 scoped to structural/
     responsive changes only, keeping the site's current look (no custom fonts,
     existing named CSS colors)?
  2. The real `<select>` elements are jQuery UI `.selectmenu()` widgets
     (`main.js:655,666,677`), not plain `<select>`s — they generate their own
     popup DOM. Should Stage 3 swap them to native `<select>` elements, or keep
     jQuery UI's widget and empirically test its popup positioning inside the
     new menu panel's clip/scroll/transition machinery first?
- Stage 3 Execution (actual edits to `index.html` and `main.js` in this worktree) has
  not started — everything above is Design/Planning only.
- No commit, push, or merge beyond this planning doc is authorized yet.
