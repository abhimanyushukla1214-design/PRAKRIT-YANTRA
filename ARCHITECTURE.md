# LoopGrid — Technical Track

Architecture, data flow and AI design for the LoopGrid smart waste exchange
(HackTheCircle · Sustainability & Social Impact).

Two things are described here, kept deliberately separate:

1. **What ships today** — the working demo in this repo. No model runs at
   inference time; the classifier, sensors and routing numbers are scripted.
2. **The AI track** — the exact models, data and serving path that replace the
   scripted parts, with the same UI contracts so the swap is drop-in.

Being explicit about the line between the two is the point. The demo is a
product shell with honest placeholders; the track below is how each placeholder
becomes real.

---

## 1. One-line summary

> A scan-to-marketplace loop: a phone camera classifies a waste item, the
> classifier picks the bin and estimates resale value, the item becomes a
> listing, nearby buyers and collectors are matched, a route optimiser plans the
> pickup, and every handoff is written to an auditable carbon ledger.

---

## 2. What runs today

| Layer | Implementation | Where |
|---|---|---|
| UI | Hand-written HTML + CSS + vanilla JS, no framework | `index.html`, `assets/styles.css` |
| State | Single in-memory `state` object, reset on reload | `assets/app.js` |
| Routing | Hash-free SPA page switch with push transition | `assets/app.js` |
| Classifier | Lookup table of 7 samples, fixed confidence per sample, 950 ms fake latency | `SAMPLES`, `classify()` |
| Bins | 8 hard-coded bins with fill %, positions on a stylised map | `BINS` |
| Route | Fixed permutation, plus "skip bins under 40%" filter; distance from a 4-case table | `OPT_ORDER`, `routeStats()` |
| Impact | Per-role constant metrics, hand-authored bar/donut series | `ROLE_DATA` |
| Ledger | 5 hard-coded rows, CSV export built in the browser | `LEDGER` |
| Hosting | Static files; Streamlit wrapper for cloud deploy | `streamlit_app.py` |

There is **no backend, no database and no model** in the current build. Nothing
is persisted. The UI labels the classifier, sensors and routing as modelled so
the demo never claims otherwise.

---

## 3. Current architecture

```
┌──────────────────────────────── Browser ────────────────────────────────┐
│                                                                          │
│  index.html ──► styles.css (tokens, layout, motion)                      │
│       │                                                                  │
│       └──► app.js                                                        │
│              ├── state { role, page, sample, listings, points, route… }   │
│              ├── SAMPLES / BINS / ROLE_DATA / LEDGER   (static data)     │
│              ├── classify()   ── 950 ms wait ──► renderScanResult()      │
│              ├── publish()    ── unshift listing ──► marketplace         │
│              ├── routeStats() ── lookup table ──► map + summary          │
│              └── exportCsv()  ── Blob + <a download>                     │
│                                                                          │
│  camera (optional) ── getUserMedia ──► <video> preview only              │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 Streamlit wrapper (streamlit_app.py)
                 copies site → ./static, embeds via st.iframe
```

Everything is client-side, which is why the demo survives a bad venue network.

---

## 4. Target architecture

```
┌──────────── Edge / phone ────────────┐        ┌──────────── Cloud ────────────┐
│                                      │        │                               │
│  Camera ─► frame grab (1 fps)        │        │  API (FastAPI)                │
│      │                               │        │   ├── /scan        (fallback) │
│      ▼                               │        │   ├── /listings                │
│  YOLOv8n detector (ONNX, int8)       │  HTTPS │   ├── /listings/:id/accept     │
│      │  crops                         │ ─────► │   ├── /routes/optimise        │
│      ▼                               │        │   ├── /bins/:id/forecast      │
│  MobileNetV3-Small classifier        │        │   └── /impact/export          │
│      │  logits ─► softmax            │        │                               │
│      ▼                               │        │  Postgres (listings, pickups, │
│  confidence gate ≥ 0.70              │        │  ledger)                      │
│      │                               │        │  Redis (bin state, sessions)  │
│      ├── pass ─► bin + value + draft │        │  S3 (scan images, reports)    │
│      └── fail ─► "split this bag"    │        │                               │
│                                      │        │  Workers                      │
│  UI renders result, user confirms    │        │   ├── matching (embeddings)   │
│                                      │        │   ├── fill forecast (cron)    │
│                                      │        │   └── ESG rollup (nightly)    │
└──────────────────────────────────────┘        └───────────────────────────────┘
                                                          ▲
                                                          │ MQTT
                                            ┌─────────────┴──────────────┐
                                            │  Bin sensors (ESP32 +      │
                                            │  ultrasonic + load cell)   │
                                            └────────────────────────────┘
```

Why edge-first for vision: the image never leaves the phone, inference works
offline in a basement bin room, and latency stays under ~100 ms. The cloud path
exists only as a fallback for low-end devices and for audit.

---

## 5. The AI track

### 5.1 Vision classifier — the core model

**Job:** given one photo, return `{material, category, confidence, bin,
contamination_flag}`.

**Model:** MobileNetV3-Small, fine-tuned, 224×224 input, 8 output classes.

| Property | Value |
|---|---|
| Backbone | MobileNetV3-Small (ImageNet pretrained) |
| Params / size | ~2.5 M params · ~4.2 MB fp32 · ~1.2 MB int8 |
| Classes | PET, HDPE, paper/cardboard, glass, metal, textile, e-waste, organics |
| Head | Global pool → dropout 0.2 → dense 8 → softmax |
| Training | 2-stage: frozen backbone (5 epochs, lr 1e-3), then full fine-tune (15 epochs, lr 1e-4) |
| Augmentation | RandomResizedCrop, horizontal flip, colour jitter, slight rotation |
| Loss | Class-weighted cross-entropy (e-waste and glass are rare) |
| Export | ONNX opset 17 → int8 dynamic quantization |
| Runtime | ONNX Runtime Web (WASM, WebGPU when available) |

**Why this model:** it is small enough to ship inside a PWA, runs at 30–80 ms per
frame on a mid-range Android, and is accurate enough for coarse material
routing. A larger model buys accuracy the task does not need — the confidence
gate catches the hard cases instead.

**Detection stage (multi-item bags):** a YOLOv8n detector (3.2 M params, 8.7
GFLOPs) finds object boxes; each crop is resized to 224 and passed to the
classifier. Single-item photos skip detection and classify the full frame. This
is what makes "mixed bag" a real output rather than a hard-coded sample.

**How inference works, step by step:**

1. Capture a frame from `<video>` into an offscreen canvas at 640×640.
2. Letterbox-resize to the detector input, normalise to `[0,1]`, NCHW.
3. Detector returns boxes + objectness; keep boxes above 0.35.
4. For each box: crop, resize to 224×224, normalise with ImageNet mean/std.
5. Classifier returns 8 logits → softmax → per-class probability.
6. Aggregate per crop; the dominant material is the argmax across crops weighted
   by box area.
7. **Confidence gate:** if `p_max < 0.70`, do not auto-route. Return
   "needs sorting" and ask the user to separate the bag.
8. If `p_max ≥ 0.70`, map class → bin, look up ₹/kg and CO₂e factor, and build
   the listing draft.
9. Show the result with the top-3 classes so the user can override — every
   override is logged as a training label.

**Contamination:** a second 2-class head (`clean` / `contaminated`) trained on
the same crops. A contaminated prediction downgrades the grade and blocks
resale listing, matching today's "mixed bag" behaviour.

**Test-time augmentation:** optional horizontal-flip TTA, +1.5–2 pts accuracy,
doubles latency — off by default on mobile.

**Data:**

| Source | Size | Use |
|---|---|---|
| TrashNet | 2,527 images, 6 classes | pretraining the head |
| TACO | ~1,500 images, 60 litter categories | detector + rare classes |
| Local capture (Delhi households, societies, 3 kabadiwalas) | target 3,000 | domain adaptation: Indian packaging, Hindi labels, mixed bags |
| Synthetic mixes | 500 composites | multi-item and contamination cases |

Split 70/15/15 by **site**, not by image, so the same kitchen counter does not
appear in train and test.

**Metrics and acceptance:**

| Metric | Target |
|---|---|
| Top-1 accuracy (held-out sites) | ≥ 0.90 |
| Macro F1 | ≥ 0.85 |
| E-waste recall | ≥ 0.95 (safety-critical) |
| Contamination precision | ≥ 0.80 |
| p95 on-device latency | ≤ 120 ms |
| Model payload | ≤ 6 MB total |

**Fallback path:** if the model is unavailable (old browser, no WASM), the UI
falls back to the 7-item sample list exactly as it does today — the demo never
breaks.

### 5.2 Marketplace matching

**Today:** category + search filters, verified toggle, and a recency boost so a
just-published listing sorts first (`posted === 'Just now' ? 10 : 0`).

**Real:** a two-stage ranker.

1. **Candidate generation** — embeddings of `material + grade + locality +
   quantity` for listings, and of `accepted materials + radius + capacity` for
   buyers. Cosine top-50 via pgvector.
2. **Ranking** — LightGBM on features: distance, price vs 30-day commodity
   median, buyer fill rate, past acceptance rate, listing freshness.
3. **Price suggestion** — quantile regression on commodity price series
   (PET flakes, OCC, aluminium) so the seller sees a fair ₹/kg band, not a
   single number.

Embeddings come from a small sentence-transformer (`all-MiniLM-L6-v2`, 22 M
params) run server-side at listing creation; no per-request model call.

### 5.3 Route optimisation

**Today:** a fixed stop order plus a fill-threshold filter. The 14.2 → 9.6 km
numbers are modelled from a 4-case table, not computed.

**Real:** OR-Tools `RoutingModel` — capacitated VRP with time windows.

- Nodes: depot + bins above the fill threshold + marketplace pickups.
- Demand: predicted fill × bin capacity.
- Constraints: vehicle capacity, driver shift, 10:00–17:00 window, one-way
  lanes, 3-minute service time.
- Objective: minimise distance, then maximise kg collected per km.
- Solver: `PATH_CHEAPEST_ARC` first solution, `GUIDED_LOCAL_SEARCH` with a 2 s
  budget — good enough for 8–60 stops, runs in a worker, not in the request.

This is optimisation, not machine learning. Calling it AI would be dishonest;
it is the deterministic half of the loop and it is what makes the savings
auditable.

### 5.4 Fill-level forecasting

Sensor pings (ultrasonic distance → fill %) arrive every 15 minutes. A
LightGBM quantile model per bin, features: hour, weekday, lag 1 h / 24 h / 7 d,
rolling mean, local event flag. Output: predicted fill at +6 h / +24 h with a
P90 band.

Use: a bin predicted to cross 85% before the next scheduled pass is pulled into
today's route. That is the mechanism behind "IIT Gate 2 crossed 85%" in the
demo.

Cold start: first 14 days use a seasonal-naive baseline (same hour last week),
then switch to the model once enough history exists.

### 5.5 ESG and carbon accounting

Not a model — an auditable calculation, which is the point.

```
kg_co2e_avoided = kg_material × factor[material] × (1 − contamination_penalty)
```

Factors are table-driven (CPCB / BEE style recycling-avoided-emission factors,
versioned in the repo). Every pickup row stores: material, kg, factor version,
hash of the previous row, timestamp. The CSV export walks that chain, so a
report can be re-derived and tampered rows break the chain.

---

## 6. Data contracts

The UI already renders these shapes, so the real backend can drop in without
touching the front end.

**Scan result**

```json
{
  "scan_id": "sc_01J9…",
  "material": "PET",
  "category": "Plastic",
  "confidence": 0.96,
  "top3": [["PET", 0.96], ["HDPE", 0.02], ["Glass", 0.01]],
  "contaminated": false,
  "bin": "blue",
  "grade": "A",
  "price_per_kg": 14,
  "co2e_factor": 1.9,
  "model": { "name": "lg-vision", "version": "0.3.1", "runtime": "onnx-web" }
}
```

**Listing**

```json
{
  "id": "LG-1042",
  "material": "PET bottles",
  "category": "Plastic",
  "qty_kg": 40,
  "price_per_kg": 14,
  "locality": "Green Park",
  "seller_id": "u_88",
  "verified": true,
  "grade": "A",
  "co2e_kg": 76,
  "status": "listed",
  "created_at": "2026-10-31T09:12:00+05:30"
}
```

**Pickup / ledger row**

```json
{
  "pickup_id": "PU-9037",
  "listing_id": "LG-1042",
  "collector_id": "c_12",
  "kg": 40,
  "price_per_kg": 14,
  "co2e_kg": 76,
  "prev_hash": "0x81cc7d2f",
  "hash": "0x4ab9e310",
  "at": "2026-10-31T11:40:00+05:30"
}
```

---

## 7. End-to-end flows

**A. Scan → listing (the demo path)**

```
user taps Scan
  → camera frame (or sample)
  → [edge] detector → crops → classifier → softmax
  → gate 0.70 ── fail → "split this bag", stop
              └─ pass → bin + ₹/kg + CO₂e + grade
  → UI shows result, top-3, tip
  → user confirms
  → POST /listings  (optimistic UI: listing unshifted locally)
  → 200 with server id → listing id swapped in
  → marketplace opens, new listing ranked first by recency
```

**B. Buyer match**

```
listing created
  → worker embeds listing text
  → pgvector top-50 buyers in radius
  → LightGBM re-rank → top-3 notified (push + WhatsApp)
  → buyer accepts → status "matched", QR issued
```

**C. Pickup**

```
collector scans QR
  → POST /listings/:id/accept {kg_actual}
  → weight check vs listed qty (±10% tolerance)
  → ledger row appended (prev_hash → hash)
  → points credited to seller, CO₂e added to impact
```

**D. Route**

```
cron 06:00
  → bins with forecast > 85% before next pass
  → OR-Tools CVRP (2 s budget)
  → route published to driver app
  → 14.2 km baseline → 9.6 km optimised, 5 stops, 1.6 L diesel saved
```

**E. ESG export**

```
user taps Export
  → GET /impact/export?from=&to=&role=
  → walk ledger, verify hash chain
  → CSV: pickup, material, kg, factor, co2e, prev_hash, hash
  → 200 text/csv
```

---

## 8. Model card (short)

| Field | Value |
|---|---|
| Intended use | Coarse material routing for household/society/business waste in Delhi-NCR |
| Out of scope | Hazardous chemical ID, medical waste, e-waste data destruction |
| Inputs | RGB photo, 224×224 after crop |
| Outputs | 8-class distribution + contamination flag |
| Known failure modes | Transparent PET on dark backgrounds, crushed cans vs foil, wet paper, mixed bags |
| Mitigation | Confidence gate, top-3 override, contamination head, retraining on overrides |
| Bias risk | Training skew toward packaged FMCG brands common in metros; rural/other-city packaging underrepresented |
| Human oversight | Every low-confidence scan requires a human decision; overrides are logged |
| Privacy | Frames processed on-device by default; uploads only with explicit consent |

---

## 9. Stack: today vs production

| Concern | Today | Production |
|---|---|---|
| Front end | HTML/CSS/vanilla JS | Same, as a PWA (service worker + manifest) |
| Vision | Lookup table | YOLOv8n + MobileNetV3-Small, ONNX Runtime Web |
| API | none | FastAPI + Pydantic, async |
| DB | in-memory | Postgres + pgvector |
| Cache / queues | none | Redis, Celery or RQ |
| Files | none | S3-compatible object store |
| Routing | lookup table | OR-Tools CVRP |
| Forecasting | constants | LightGBM quantile per bin |
| Matching | recency sort | MiniLM embeddings + LightGBM ranker |
| Sensors | simulated | ESP32 + ultrasonic + load cell over MQTT |
| Auth | role switch | OTP phone login, JWT |
| Hosting | static / Streamlit | Static CDN + container API |
| Observability | console | OpenTelemetry, Sentry, model drift dashboard |

---

## 10. Deployment topology

**Demo (this repo).** Static files, optionally wrapped by Streamlit:
`streamlit_app.py` copies the site into `static/`, Streamlit serves it at
`/app/static/…`, and `st.iframe` embeds it full-viewport with camera and
downloads allowed.

**Production.**

```
CDN ── index.html, app.js, model.onnx, wasm
 │
 ├── /api  ── FastAPI container (2 replicas, autoscale on CPU)
 │             ├── Postgres (managed, pgvector)
 │             ├── Redis (managed)
 │             └── S3
 │
 └── workers ── route optimiser, matcher, forecaster, ESG rollup
```

Model updates ship as versioned files (`model-0.3.1.onnx`) referenced by a
manifest, so a bad release can be rolled back without an app update.

---

## 11. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | Scan result ≤ 150 ms p95 on-device; API p95 ≤ 300 ms |
| Offline | Scan, classify and queue listing with no network; sync on reconnect |
| Payload | Initial JS + CSS ≤ 250 KB gzipped; model ≤ 6 MB, lazy-loaded |
| Privacy | On-device inference by default; no image upload without consent; EXIF stripped |
| Security | Signed listings, hash-chained ledger, rate-limited scan endpoint |
| Accessibility | Keyboard-complete, visible focus, `prefers-reduced-motion` honoured |
| Motion | Only `transform`/`opacity`, no `transition: all`, temporary `will-change` |
| Reliability | Classifier failure degrades to manual material picker, never a dead end |

---

## 12. Roadmap

| Phase | Scope | Outcome |
|---|---|---|
| 0 (done) | Static product shell, scripted classifier, marketplace, routes, impact, Streamlit deploy | Demo that tells the story end to end |
| 1 (2 weeks) | Collect and label 1,000 local images, train MobileNetV3-Small, export ONNX | Real classifier at ≥ 0.85 top-1 |
| 2 (2 weeks) | FastAPI + Postgres, real listings, QR pickup, ledger writes | Persistence and multi-user demo |
| 3 (2 weeks) | OR-Tools routing on real coordinates, sensor simulator | Auditable km and fuel savings |
| 4 (1 month) | 3 society pilot, 20 bins, 2 kabadiwala partners | Real weights, real buyers, real carbon |
| 5 | Matching ranker, price suggestion, forecast model | Marketplace liquidity |

---

## 13. Demo vs production, stated plainly

| Claim in the demo | Status |
|---|---|
| "Classifier returns PET at 96%" | Scripted lookup, not a model |
| "Bin at IIT Gate 2 is 88% full" | Hard-coded, not sensor-fed |
| "14.2 km → 9.6 km, 1.6 L saved" | Modelled from a 4-case table, not solved |
| "₹14/kg resale value" | Illustrative market rate |
| "Hash-chained ledger" | Rows are demo data; the chain format is real |
| "ESG CSV export" | Real download, demo rows |
| Camera preview | Real `getUserMedia`, classification still scripted |

Everything above is labelled as modelled inside the UI. Nothing here claims a
trained model, live sensors or paying buyers.

---

## 14. Likely judge questions

**"Is this actually AI?"**
Today: no — it is a scripted demo with a real product surface. The track above
is the model, data and serving path, and the UI contracts are already shaped for
it. We would rather show an honest shell than fake a model.

**"Why on-device instead of cloud?"**
Privacy (waste photos show homes), offline reliability in bin rooms, and latency.
Cloud is the fallback, not the default.

**"Why MobileNetV3 and not a big model?"**
The task is 8 coarse classes. A 1.2 MB int8 model at 30–80 ms beats a 100 MB
model at 800 ms for a user standing over a bin. The confidence gate handles the
tail.

**"How do you know it works?"**
Held-out accuracy by site, macro F1, e-waste recall, contamination precision,
p95 latency — thresholds in §5.1. Until those are met, the app keeps the
scripted fallback.

**"What breaks at scale?"**
Buyer liquidity per locality, sensor battery life, and label drift as packaging
changes. Mitigations: seeded buyer pools per pincode, 6-month battery budget with
15-minute pings, quarterly relabelling from overrides.
