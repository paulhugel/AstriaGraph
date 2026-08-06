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
  binary breakpoint split.

## Mockups (interactive, published as Claude Artifacts — not part of this repo)

1. v1 collapsible drawer (superseded): `astriagraph-mobile-mockup.html`
2. v2/v3 unified menu (current, post-fixes): `astriagraph-unified-menu-mockup.html`

Both are scratch files outside the repo; they are not committed here and will not
persist beyond the authoring session's local temp directory. This doc is the durable
record of the decisions they demonstrated.

## Open items / next steps

- A third independent Review/Validation pass on the fixed v3 mockup has not yet run.
- Stage 3 Execution (actual edits to `index.html` and `main.js` in this worktree) has
  not started — everything above is Design/Planning only.
- No commit, push, or merge beyond this planning doc is authorized yet.
