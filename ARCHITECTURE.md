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

> A scan-to-marketplace loop: a phone camera classifies a waste item, a
> calibrated model returns a prediction **set** instead of a fake confidence,
> the item becomes a listing, nearby buyers and collectors are matched, a route
> optimiser plans the pickup, and both parties co-sign every handoff into an
> externally anchored carbon ledger.

---

## 2. What runs today

| Layer | Implementation | Where |
|---|---|---|
| UI | Hand-written HTML + CSS + vanilla JS, no framework | `index.html`, `assets/styles.css` |
| State | Single in-memory `state` object, reset on reload | `assets/app.js` |
| Routing | SPA page switch with push transition | `assets/app.js` |
| Classifier | Lookup table of samples, fixed confidence, 950 ms fake latency | `SAMPLES`, `classify()` |
| Bins | Hard-coded fill %, positions on a stylised map | `BINS` |
| Route | Fixed permutation + "skip under 40%" filter; distance from a 4-case table | `OPT_ORDER`, `routeStats()` |
| Impact | Per-role constants, hand-authored chart series | `ROLE_DATA` |
| Ledger | 5 hard-coded rows, CSV export in the browser | `LEDGER` |
| Hosting | Static files; Streamlit wrapper for cloud deploy | `streamlit_app.py` |

There is **no backend, no database and no model** in the current build. Nothing
is persisted. The UI labels the classifier, sensors and routing as modelled so
the demo never claims otherwise.

---

## 3. Current architecture

```
┌──────────────────────────────── Browser ────────────────────────────────┐
│  index.html ──► styles.css (tokens, layout, motion)                      │
│       └──► app.js                                                        │
│              ├── state { role, page, sample, listings, points, route… }   │
│              ├── SAMPLES / BINS / ROLE_DATA / LEDGER   (static data)     │
│              ├── classify()   ── 950 ms wait ──► renderScanResult()      │
│              ├── publish()    ── unshift listing ──► marketplace         │
│              ├── routeStats() ── lookup table ──► map + summary          │
│              └── exportCsv()  ── Blob + <a download>                     │
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
│  Camera ─► frame grab                │        │  API (FastAPI)                │
│      │                               │        │   ├── /scan        (fallback) │
│      ▼                               │        │   ├── /listings                │
│  YOLOv8n detector (ONNX, int8)       │  HTTPS │   ├── /listings/:id/accept     │
│      │  crops (or "split the bag")   │ ─────► │   ├── /routes/optimise        │
│      ▼                               │        │   ├── /bins/:id/forecast      │
│  MobileNetV3-Small classifier        │        │   ├── /ledger/:id/cosign      │
│      │  logits ─► temperature ─► softmax      │   └── /impact/export          │
│      ▼                               │        │                               │
│  conformal set (90% coverage)        │        │  Postgres (listings, pickups, │
│      ├ 1 class  ─► auto-route        │        │  ledger, signatures)          │
│      ├ 2+ classes ─► ask the user    │        │  Redis (bin state, sessions)  │
│      └ ∅ / OOD ─► "needs human"      │        │  S3 (scan images, reports)    │
│                                      │        │                               │
│  EXIF strip + background blur        │        │  Workers                      │
│  IndexedDB queue when offline        │        │   ├── Merkle anchor (daily)   │
│                                      │        │   ├── fill forecast (cron)    │
│  UI renders set, user confirms       │        │   ├── fraud checks            │
└──────────────────────────────────────┘        │   └── ESG rollup (nightly)    │
                                                └──────────────▲───────────────┘
                                                               │ MQTT
                                                 ESP32 bin sensors
```

Why edge-first for vision: the image never leaves the phone, inference works
offline in a basement bin room, and latency stays under ~100 ms. The cloud path
exists only as a fallback for low-end devices and for audit.

---

## 5. The AI track

### 5.1 Scope: three models, on purpose

| Model | Job | Status |
|---|---|---|
| **Classifier** — MobileNetV3-Small | material + contamination | Week 1 |
| **Detector** — YOLOv8n (or a "split the bag" gate) | one item vs several | Week 1–2 |
| **Fill forecast** — LightGBM quantile | bin overflow before it happens | Phase 3 |

Everything else is deliberately **rule-based** until there is data to learn
from:

| Function | Until 500 transactions | Why |
|---|---|---|
| Buyer matching | radius + material + verified + recency | a ranker with no acceptance history learns noise |
| Price suggestion | published commodity band + grade multiplier | same cold-start problem |
| Routing | OR-Tools CVRP | optimisation, not ML — deterministic and auditable |
| Carbon | factor table × weight | an accounting rule, not a prediction |

Shipping six models would invite "show me the data". Shipping three and saying
*why* the others wait is the more defensible story — and it makes the roadmap
credible.

### 5.2 Vision classifier

**Model:** MobileNetV3-Small, fine-tuned, 224×224 input, 13 classes.

| Property | Value |
|---|---|
| Backbone | MobileNetV3-Small (ImageNet pretrained) |
| Params / size | ~2.5 M params · ~4.2 MB fp32 · ~1.2 MB int8 |
| Head | Global pool → dropout 0.2 → dense 13 → softmax |
| Training | 2-stage: frozen backbone (5 epochs, lr 1e-3), then full fine-tune (15 epochs, lr 1e-4) |
| Loss | Class-weighted cross-entropy (hazardous classes up-weighted) |
| Export | ONNX opset 17 → int8 dynamic quantization |
| Runtime | ONNX Runtime Web (WASM, WebGPU when available) |

**Why this model:** it is small enough to ship inside a PWA, runs at 30–80 ms per
frame on a mid-range Android, and is accurate enough for coarse material
routing. The gate below — not model size — handles the hard cases.

### 5.3 Calibration and the gate

Softmax scores are overconfident: a 0.70 output does not mean 70% correct. Two
fixes, both cheap.

**Temperature scaling.** Fit a single temperature `T` on a held-out calibration
split, divide logits by `T` before softmax. Report:

- **ECE** (expected calibration error), target < 0.05
- a **reliability diagram** in the repo (`docs/calibration.png`)
- Brier score alongside accuracy

**Conformal prediction.** Split conformal with a 90% target coverage:

1. Hold out a calibration set the model never trains on.
2. Compute nonconformity score `1 − p̂(y)` for each calibration image.
3. Take the ⌈(n+1)·0.90⌉-th smallest score as threshold `q̂`.
4. At inference, include every class whose score ≤ `q̂`.

The output is a **set**, and the UI acts on its size:

| Set size | Meaning | UI |
|---|---|---|
| 1 | model is sure | auto-route, show the class |
| 2–4 | ambiguous | show all, ask the user to pick |
| 0 or `unknown` | out-of-distribution | "needs human review", manual picker |

That is the sentence worth putting on a slide: *the model knows when it doesn't
know, with a statistical guarantee* — 90% of the time the true class is inside
the returned set, assuming exchangeability. The caveat is stated, not hidden.

**Unknown / OOD.** Two triggers: an empty conformal set, or max softmax below a
floor (0.35) after temperature scaling. Either way the item is not routed
automatically. Sanitary waste, batteries and unknown composites land here far
more often than they should land in a confident wrong bin.

### 5.4 Detection stage

A YOLOv8n detector (3.2 M params) finds boxes; each crop is resized to 224 and
classified. If more than one box exceeds the area threshold, the result becomes
"multiple items — split the bag" rather than a single material. Single-item
photos skip detection and classify the full frame.

For Week 1 this can ship as a simpler gate: if the classifier's conformal set is
large and the image has high edge density in several regions, ask the user to
split the bag. The detector is the upgrade, not a blocker.

### 5.5 Fill-level forecasting

Sensor pings (ultrasonic distance → fill %) arrive every 15 minutes. A
LightGBM quantile model per bin, features: hour, weekday, lag 1 h / 24 h / 7 d,
rolling mean, local event flag. Output: predicted fill at +6 h / +24 h with a
P90 band.

Use: a bin predicted to cross 85% before the next scheduled pass is pulled into
today's route. Cold start: seasonal-naive baseline (same hour last week) for the
first 14 days, then switch to the model.

### 5.6 Routing

OR-Tools `RoutingModel` — capacitated VRP with time windows.

- Nodes: depot + bins above threshold + marketplace pickups.
- Demand: predicted fill × bin capacity.
- Constraints: vehicle capacity, driver shift, 10:00–17:00 window, 3-minute
  service time, one-way lanes.
- Objective: minimise distance, then maximise kg per km.
- Solver: `PATH_CHEAPEST_ARC` + `GUIDED_LOCAL_SEARCH`, 2 s budget.

This is optimisation, not machine learning. Calling it AI would be dishonest;
it is the deterministic half of the loop and it is what makes the savings
auditable.

---

## 6. Waste taxonomy

The eight-class list was too clean for Indian waste. The classes that actually
cause contamination are the ones that were missing.

| Class | Bin | Notes |
|---|---|---|
| PET | blue | bottles, food trays |
| HDPE | blue | jugs, caps, buckets |
| PP / mixed plastic | blue | containers, caps |
| Paper / cardboard | blue | OCC, newspaper, office paper |
| Glass | blue (crate) | jars, bottles |
| Metal | blue | cans, foil, utensils |
| Textile | white sack | cotton, denim, synthetics |
| Organics | green | food, garden |
| **Multilayer packaging** | **reject** | chip and biscuit wrappers — no viable recycling stream in Delhi |
| **Tetra Pak** | **special** | only specific buyers; otherwise reject |
| **Thermocol** | **reject** | fragile, no local buyer |
| **Sanitary / biomedical** | **hazardous** | never in household bins |
| **Batteries** | **hazardous** | certified handler only |

**Hazardous override.** `sanitary`, `biomedical`, `battery`, `e-waste` carry a
`hazard: true` flag. It overrides the material class in the UI and the API:

- no marketplace listing
- no points for disposal (points would incentivise unsafe handling)
- a certified-handler pickup request instead
- a hard block in the confirm endpoint, not just a UI warning

**Contamination is multi-label**, not a 2-class head: `food residue`, `wet`,
`mixed material`, `hazardous present`, `clean`. A wet cardboard box and a
greasy pizza box are different problems; one contaminates the paper stream, the
other is compostable.

---

## 7. Weight, carbon and additionality

Every CO₂e number depends on weight, and **a photo cannot give weight**. The
honest chain is:

```
photo  →  estimated weight band (±30%)   →  collector-confirmed kg (truth)
```

**Ground truth** is the collector's scale at pickup. The listing carries an
estimate; the ledger carries the confirmed weight. Points and carbon settle on
the confirmed number, so inflating the photo estimate gains nothing.

**Ranges, not points.** Every impact figure renders as a band with a factor
version, e.g. `18–26 kg CO₂e · factor v2026.10`, never a bare `22 kg`. The
factor table is versioned in the repo, so any number can be re-derived years
later.

**Additionality.** Kabadiwalas already collect most PET and cardboard. Counting
all of it as avoided emissions is greenwashing. The claim is:

```
additional_kg = kg × additional_fraction[material, locality]
co2e_band     = additional_kg × factor[material] ± uncertainty
```

`additional_fraction` is the share that would otherwise have gone to landfill or
open burning, estimated from a local baseline survey (starting values:
PET 0.35, OCC 0.25, glass 0.30, organics 0.60, textile 0.70, e-waste 0.55 —
marked as survey estimates, revised quarterly). The UI shows "additional
diversion" next to "total collected", so the two are never conflated.

**Ledger formula, per pickup:**

```
co2e_low, co2e_high = kg_confirmed × additional_fraction × (factor ± 15%)
```

---

## 8. Trust: signatures, Merkle anchor, anti-fraud

A hash chain is tamper-**evident**, not tamper-**proof**: the operator can
rewrite the whole chain from genesis. Three layers fix that.

**1. Dual signatures per handoff.** Each pickup row is signed by the collector
and countersigned by the buyer with Ed25519 keys held on their devices. The
server stores both signatures; it cannot mint a row alone. A row is valid only
with two signatures over the canonical payload.

**2. Daily Merkle root, anchored externally.** Every 24 h the server builds a
Merkle tree over that day's row hashes and publishes the root to a public git
repository plus an OpenTimestamps stamp. Anyone can recompute the root from the
exported CSV and compare. Editing history now requires rewriting a public
commit history and a timestamp — visibly.

**3. Anti-fraud checks** (server-side, on every claim):

| Check | Method | Action |
|---|---|---|
| Reused photo | perceptual hash (pHash), Hamming ≤ 6 | reject, flag account |
| Wrong place | GPS within 150 m of listed locality, time within window | hold for review |
| Weight anomaly | z-score of kg per category per collector, \|z\| > 3 | hold payout |
| Collusion | generator–collector pair frequency vs baseline, ring detection | freeze pair, manual audit |
| Velocity | > N scans/hour or > M kg/day per account | rate limit, review |

Overrides and low-confidence scans go to a **review queue** before they become
training labels, so one bad actor cannot poison the model.

---

## 9. Privacy, consent, offline

| Concern | Implementation |
|---|---|
| Consent | DPDP Act 2023 notice before the first scan: purpose, retention, withdrawal |
| Data minimisation | inference on-device; upload only on explicit "share this scan" |
| Metadata | EXIF stripped on-device before any upload |
| Bystanders | background blurred on-device (segmentation mask), not server-side |
| Retention | images 30 days, ledger rows forever (no personal data), account deletion honoured |
| Offline | scans queued in IndexedDB with a local id, synced on reconnect, idempotent by client id |
| Low-end devices | WASM fallback, 160×160 input, detection disabled, manual picker always available |

---

## 10. Data contracts

**Scan result**

```json
{
  "scan_id": "sc_01J9…",
  "material": "PET",
  "category": "Plastic",
  "prediction_set": ["PET"],
  "set_size": 1,
  "coverage": 0.90,
  "calibrated_p": 0.91,
  "contamination": ["clean"],
  "hazard": false,
  "bin": "blue",
  "grade": "A",
  "weight_est_kg": [17, 32],
  "price_band": [12, 16],
  "co2e_band_kg": [18, 26],
  "factor_version": "2026.10",
  "model": { "name": "lg-vision", "version": "0.3.1", "runtime": "onnx-web" }
}
```

**Listing**

```json
{
  "id": "LG-1042",
  "material": "PET bottles",
  "qty_est_kg": 25,
  "price_band": [12, 16],
  "locality": "Green Park",
  "seller_id": "u_88",
  "verified": true,
  "grade": "A",
  "source_score": 85,
  "status": "listed",
  "created_at": "2026-10-31T09:12:00+05:30"
}
```

**Ledger row**

```json
{
  "pickup_id": "PU-9037",
  "listing_id": "LG-1042",
  "kg_confirmed": 24.6,
  "price_per_kg": 14,
  "co2e_band_kg": [18, 26],
  "factor_version": "2026.10",
  "prev_hash": "0x81cc7d2f",
  "hash": "0x4ab9e310",
  "collector_sig": "ed25519:…",
  "buyer_sig": "ed25519:…",
  "at": "2026-10-31T11:40:00+05:30"
}
```

---

## 11. End-to-end flows

**A. Scan → listing**

```
user taps Scan
  → frame (or sample) → EXIF strip → on-device
  → detector → crops → classifier → temperature → conformal set
  → set size 1  → bin + grade + weight band + price band
    set size 2+ → user picks, choice logged to review queue
    set ∅/OOD   → manual picker, no auto-route
  → hazard? → certified pickup request, stop
  → confirm → POST /listings (optimistic UI, server id swapped in)
  → marketplace, new listing ranked first
```

**B. Buyer match**

```
listing created
  → rule-based: material + radius + verified + recency
  → top-3 notified (push + WhatsApp)
  → buyer accepts → QR issued
  → (re-ranker only after 500 accepted transactions)
```

**C. Pickup and co-sign**

```
collector scans QR → weighs → POST /accept {kg_confirmed}
  → fraud checks (pHash, GPS, weight z-score, collusion)
  → collector signs row → buyer countersigns
  → hash chained, both sigs stored
  → points and carbon settle on kg_confirmed
```

**D. Route**

```
cron 06:00 → bins forecast > 85% before next pass
  → OR-Tools CVRP (2 s) → driver app
  → 14.2 km baseline → 9.6 km optimised, 5 stops
```

**E. ESG export**

```
GET /impact/export?from=&to=&role=
  → walk ledger, verify hash chain + both signatures
  → recompute Merkle root, compare to published anchor
  → CSV: pickup, kg, factor version, co2e band, prev_hash, hash, sigs
```

---

## 12. Evaluation protocol

| Test | Protocol | Target |
|---|---|---|
| Top-1 accuracy | held-out **sites**, not images | ≥ 0.90 |
| Macro F1 | per class, rare classes weighted | ≥ 0.85 |
| Hazardous recall | battery, sanitary, e-waste | ≥ 0.95 |
| Contamination precision | multi-label | ≥ 0.80 |
| Calibration | ECE on held-out set | ≤ 0.05 |
| Conformal coverage | empirical vs nominal 0.90 | 0.88–0.92 |
| Set size | mean classes per prediction | ≤ 1.4 |
| **Hard set** | 500 wet, crushed, low-light, occluded, mixed items | report separately |
| Latency | **₹8,000 Android** (Snapdragon 4-class), p95 | ≤ 120 ms |
| Payload | model + WASM total | ≤ 6 MB |

Per-class and per-site tables go in `docs/eval.md`; a confusion matrix and the
reliability diagram go next to them. The hard set is the number judges should
ask for, because the clean benchmark flatters every model.

---

## 13. Differentiation and hooks

Existing players:

| Player | What they do | Gap LoopGrid targets |
|---|---|---|
| **Recykal** | B2B digital waste marketplace, EPR credit trading, brand compliance | supply is aggregated by large collectors; the household and kabadiwala are abstracted away |
| **Scrapuncle** | consumer scrap pickup, on-demand kabadiwala | price and pickup convenience; no source quality, no auditable chain |

Three hooks, in priority order:

**1. Co-signed handoff ledger.** Collector and buyer sign every handoff; the
daily Merkle root is published where we cannot edit it. "Nobody, including us,
can fake a carbon claim" is the line ESG buyers and brand EPR teams react to.
Recykal sells compliance; this sells *proof*.

**2. Kabadiwala-first design.** The informal sector is the actual recycling
backbone. LoopGrid gives them:

- a Hindi voice-first / WhatsApp-bot interface, not an English app
- a portable **reputation passport** built from verified, co-signed pickups
- UPI payout on QR confirmation, same day
- route and demand visibility they cannot get today

They are not a fallback in the supply chain; they are the supply chain.

**3. Source-level quality score.** Every society gets a segregation score from
its contamination history: `score = 100 − (contamination % × 1.5) −
(reject-stream % × 2.0)`, clamped 0–100, recomputed monthly from co-signed
pickups. Buyers price lots by source; generators watch their score move and lose
money when they mix. This is the behaviour loop that scanning alone does not
create — it makes clean segregation *worth* something.

Secondary hooks, if there is room: micro-lot pooling against recycler standing
orders, live price feedback when contamination is detected, Grad-CAM on the
result card, and a digital-twin slider that recomputes km/fuel/CO₂ live.

---

## 14. Demo vs production, stated plainly

| Claim in the demo | Status |
|---|---|
| "90% set · 1 class" for PET | Scripted lookup, not a model |
| Conformal set / coverage | UI shows the real contract; numbers are scripted |
| "Bin at IIT Gate 2 is 88% full" | Hard-coded, not sensor-fed |
| "14.2 km → 9.6 km" | Modelled table, not solved |
| "₹14/kg" | Illustrative band |
| CO₂e figures | Modelled bands; factor version is a placeholder |
| "Hash-chained ledger" | Chain format real, rows demo, signatures absent |
| Source quality score | Demo data, scoring rule described |
| Camera preview | Real `getUserMedia`, classification scripted |

Nothing here claims a trained model, live sensors, signed handoffs or paying
buyers.

---

## 15. Priorities

| When | Work |
|---|---|
| **Week 1** | Calibrated classifier (temperature + ECE), conformal gate at 90%, unknown/OOD path, expanded Indian class list with hazardous override, multi-label contamination |
| **Week 2** | Co-signed ledger (Ed25519) + daily Merkle anchor, source-level quality score |
| **Week 3–4** | FastAPI + Postgres, real listings, QR pickup, fraud checks |
| **Month 2** | OR-Tools on real coordinates, sensor simulator, hard-set evaluation on a ₹8,000 phone |
| **Month 3** | 3-society pilot, 20 bins, 2 kabadiwala partners |
| After 500 transactions | Matching re-ranker and price model — only then |
| Later | Micro-lot pooling, digital twin |

---

## 16. Judge questions

**"How is this different from Recykal or Scrapuncle?"**
Recykal sells compliance to brands and abstracts the household away; Scrapuncle
sells pickup convenience. LoopGrid keeps the kabadiwala as a first-class user,
co-signs every handoff so a carbon claim can be verified by a third party, and
prices lots by source quality — which changes behaviour upstream instead of
just moving waste downstream.

**"How do you know the model works on real Delhi waste?"**
Site-split evaluation (no counter in both train and test), a 500-image hard set
of wet/crushed/low-light/mixed items, per-class recall with hazardous recall
≥ 0.95, and a calibration curve with ECE ≤ 0.05. Until those pass, the app
keeps the scripted fallback.

**"What stops people gaming the points?"**
pHash duplicate detection, GPS/time validation, per-collector weight z-scores,
collusion detection on generator–collector pairs, and settlement on the
collector-confirmed weight rather than the photo estimate. Overrides go through
review before they become labels.

**"Is the carbon number real?"**
It is a range with a cited factor version, computed only on **additional**
diversion over the existing kabadiwala baseline, settled on weighed kg. We
publish the factor table and the Merkle root so the number can be checked, and
we state the uncertainty instead of hiding it.

**"Why only three models?"**
Because a matching ranker and a price model with no transaction history learn
noise. They are rule-based until 500 accepted pickups, and we say so. Three
models we can evaluate beats six we cannot.

**"What breaks at scale?"**
Buyer liquidity per locality, sensor battery life, and label drift as packaging
changes. Mitigations: seeded buyer pools per pincode, 6-month battery budget at
15-minute pings, quarterly relabelling from reviewed overrides.
