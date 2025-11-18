# AstriaGraph web UI

A static, client-side visualization that renders resident space objects in CesiumJS. This copy is configured to run on GitHub Pages without a backend by using a small static data fallback. You can also point it to a live API when available.

## GitHub Pages deployment
- Pages workflow is included and deploys on pushes to `master`/`main`: `AstriaGraph/.github/workflows/pages.yml:1`.
- Jekyll is disabled via `AstriaGraph/.nojekyll:1`.
- Cesium assets load from CDN (no large vendored `cesium/` folder):
  - CSS import: `AstriaGraph/index.html:125`
  - Base URL and script: `AstriaGraph/index.html:266`, `AstriaGraph/index.html:267`

## Static data fallback (no backend)
- When no API base is configured, the app reads static TSV files from `assets/data/`:
  - Data sources: `AstriaGraph/assets/data/www_data_sources.tsv`
  - Objects (non‑debris): `AstriaGraph/assets/data/www_query_NODEB.tsv`
  - Objects (debris): `AstriaGraph/assets/data/www_query_DEB.tsv`
- The switch is handled in code at `AstriaGraph/main.js:19`–`AstriaGraph/main.js:23`.
- TSV expectations:
  - Tab‑separated header row including at least: `Epoch`, `SMA`, `Ecc`, `Inc`, `RAAN`, `ArgP`, `MeanAnom`, `Name`, `Country`, `OrbitType`, and either `NoradId` or `CatalogId`.
  - Sample files are provided as a smoke test; replace with your datasets as needed.

## Live API configuration
- If you have a reachable API with CORS enabled, define `ASTRIAGRAPH_API_BASE` before loading `main.js`:

```html
<!-- Place this before main.js -->
<script>
  window.ASTRIAGRAPH_API_BASE = "https://your-api-host/AstriaGraph/api";
  // Optional: if deploying under a path other than repo root, ensure relative URLs are correct.
</script>
```

- With this set, the UI will call:
  - `${ASTRIAGRAPH_API_BASE}/www_data_sources` for the sources list.
  - `${ASTRIAGRAPH_API_BASE}/www_query?filter=NODEB` for non‑debris, and `...filter=DEB` when debris is toggled.

- Snippet location in this repo: `AstriaGraph/index.html:269` (commented block directly above `main.js`).

### Alternatives: config.js and config.local.js
- You can set the API base in `AstriaGraph/config.js` (loaded before `main.js`).
- For local/developer overrides without committing secrets, copy `AstriaGraph/config.local.example.js` to `AstriaGraph/config.local.js` and set values there. This file is git‑ignored and loaded after `config.js`.
- Precedence (last one wins): `config.js` → `config.local.js` → inline snippet in `index.html`.

## Local development
- Serve the folder to avoid CORS/file:// issues:
  - `cd AstriaGraph && python3 -m http.server 8080`
  - Open `http://localhost:8080/`
- Optional: point at a local API by adding the `ASTRIAGRAPH_API_BASE` snippet to `index.html` during development.

## Notes
- This repo intentionally does not vendor the Cesium build (original `.gitignore` excludes `cesium/`). The UI is pinned to CesiumJS `1.58` via CDN for API compatibility.
- Licensing remains as per `COPYING` (GPLv3). The small TSV samples are for demo only.
- A small badge at the top-right indicates data mode at runtime: "Static data" when using `assets/data/*.tsv`, or "Live API" when `ASTRIAGRAPH_API_BASE` is set.
