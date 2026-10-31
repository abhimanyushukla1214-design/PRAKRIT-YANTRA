# LoopGrid

A working front-end for the LoopGrid smart waste exchange — built for the **HackTheCircle · Sustainability & Social Impact** track.

> Delhi's waste isn't worthless. It's just in the wrong place.

The site has two parts: a marketing/overview page and a fully interactive product demo (household, society and business views).

For the architecture, the AI track and the honest demo-vs-production split, read [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Run it

No build step, no dependencies.

**Option 1 — just open it**

Double-click `index.html`. Everything works from the file system.

**Option 2 — local server (recommended for camera permission)**

```powershell
# from this folder
python -m http.server 5173
# then open http://localhost:5173
```

Camera access requires `localhost` or HTTPS in most browsers. The demo works without a camera — use the 13 sample items.

**Option 3 — Streamlit**

```powershell
pip install -r requirements.txt
streamlit run streamlit_app.py
# then open http://localhost:8501
```

If `streamlit` isn't on your `PATH` (common on Windows when pip installs into
`%APPDATA%\Python\...\Scripts`), use `python -m streamlit run streamlit_app.py`.

Streamlit cannot render a static site natively, so `streamlit_app.py` keeps this
site as-is and frames it full-viewport:

- it copies `index.html` + `assets/` into `./static`, which Streamlit serves at
  `/app/static/...` (needs `server.enableStaticServing`, already set in
  `.streamlit/config.toml`);
- it hides Streamlit's header, toolbar and padding, then embeds the page with
  `st.iframe`. Streamlit sandboxes that frame with scripts, same-origin and
  downloads allowed, and grants camera access, so the scan flow, the QR modal
  and the CSV export all keep working.

`st.iframe` is why `requirements.txt` asks for Streamlit 1.66 or newer.

The HTML/CSS/JS remain the single source of truth — edit them at the repo root
and restart Streamlit. `static/` is generated and git-ignored.

**Deploy to Streamlit Community Cloud**

1. Push this folder to a GitHub repo.
2. Go to [share.streamlit.io](https://share.streamlit.io) → **New app**.
3. Pick the repo, branch `main`, main file `streamlit_app.py`.
4. Deploy. The HTTPS URL gives the demo a real secure context, so the camera
   preview works there too.

No secrets or API keys are needed.

---

## What's inside

| Route | What it does |
|---|---|
| Overview (`#landing`) | Pitch, problem chain, six-step loop, B2C/B2B/ops layers, modelled impact, pricing |
| Overview | Dashboard with carbon ring, green points wallet, bin fill sensors, activity, onboarding checklist |
| Scan & sort | Simulated calibrated classifier: 13 sample items, 90% conformal prediction set, hazardous override, unknown/OOD path, bin, resale band, recovery score, confirm → listing |
| Marketplace | Filterable listings, search, verified toggle, save/shortlist, listing detail modal with QR + hash timeline |
| Routes & bins | Stylised South Delhi map, fill levels, route optimiser, skip-under-40% toggle, overflow prediction |
| Impact | Role-based metrics, monthly diversion chart, material donut, source-level quality score, society leaderboard, traceability ledger, CSV export |

**Demo script for judges (≈90 seconds)**

1. Landing → **Open live demo**.
2. **Scan & sort** → choose *PET bottle* → **Classify item**. The card shows a **90% conformal set with one class**, so it auto-routes. → **Confirm & list**.
3. You land in **Marketplace** with the new listing at the top.
4. Open a listing → show QR, status timeline, **Accept pickup**.
5. Back on **Scan & sort**, open *Hard cases* → **Battery** → **Request certified pickup** (no points, no listing). Then **Unknown** → **Needs review** (empty set, no auto-route).
6. **Routes & bins** → **Optimise route** → 14.2 km → 9.6 km, 3 low bins skipped.
7. **Impact** → point at the **source quality score** (contamination % → score/100) → switch Household / Society / Business → **Export ESG report**.
8. Optional: topbar role switch, **Redeem** points, mobile bottom nav.

---

## Honest demo notes

- The classifier is **scripted on 13 sample items**, not a trained model. It is labelled as a demo model in the UI.
- The conformal set is **scripted data that follows the real contract** (one class → auto-route, several → user picks, empty → human review). No calibration set exists yet.
- Bin fill levels and sensor pings are **simulated**; the UI says so.
- Routing numbers (14.2 → 9.6 km, fuel, CO₂e) are modelled, not measured.
- Marketplace sellers, weights, hashes, source quality scores and ESG rows are demo data. The scoring rule is printed on the card.
- Camera preview is real (`getUserMedia`) but classification still maps to the sample set.

This is deliberate: the deck and the app should not claim a model or hardware that does not exist yet.

---

## Motion system

Built to the brief, CSS-first:

| Interaction | Implementation |
|---|---|
| Button press | `scale(.97)` + shadow, 120 ms `cubic-bezier(.22,1,.36,1)` |
| Toggle | knob `translateX(20px)`, 130 ms ease-out |
| Save / confirm icons | `pop` keyframe, 300 ms spring overshoot |
| Modal | `scale(.95) translateY(10px)` → `scale(1)`, 300 ms / 200 ms |
| Page change | horizontal push + fade, 300 ms `cubic-bezier(.25,1,.5,1)` |
| Dropdown | `scaleY(.9)` from top origin, 200 ms |
| Skeleton | CSS shimmer, 1.5 s loop |
| Progress | `transform: scaleX()` with 400 ms ease-out |
| Spinner | 800 ms linear rotate |
| Onboarding | staggered CSS reveal, 120 ms apart |
| Landing sections | `IntersectionObserver` + reveal transitions |

Only `transform` and `opacity` are animated. `will-change` is applied only during page/modal transitions and removed afterwards. `prefers-reduced-motion` is respected globally.

---

## Files

```
index.html          structure, icon sprite, landing, app shell, modals
assets/styles.css   design tokens, components, responsive layout, motion
assets/app.js       state, routing, classifier demo, marketplace, map, charts
streamlit_app.py    Streamlit wrapper: serves the site and frames it full-screen
requirements.txt    streamlit
.streamlit/         server + theme config for the wrapper
screenshots/        desktop + mobile captures for the submission form
```

No frameworks, no bundler, no network dependency except the Google Fonts link (falls back to system fonts offline).

**On mobile**, the bottom bar has Home, Scan, Market and Impact. *Routes & bins* opens from the two map tiles on the Overview page.

---

## Design tokens

- Forest green `#1B5E20`
- Teal `#00897B`
- Navy `#0B1F3A`
- Light grey `#F5F8F4`
- Display type: Sora · Body: Inter

---

## Notes for the next iteration

- Replace the scripted classifier with a calibrated MobileNetV3-Small (temperature scaling + a 90% conformal gate) served from a small FastAPI endpoint.
- Swap the SVG map for Leaflet + OpenStreetMap and an OR-Tools routing call.
- Persist listings, points and saved items (currently in-memory so every demo starts clean).
- Replace the demo hash chain with dual-signed Ed25519 handoffs and a daily Merkle anchor before calling the ESG export audited.
