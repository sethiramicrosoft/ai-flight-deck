# Performance reviewer review of value-realization

## Summary
`ai-flight-deck` is new versus HEAD, so this pass reviewed the full uncommitted implementation. I focused on evidence-completion rendering, repeated planning/rendering in `index.html`, server evidence APIs, package parsing, attestation application, collectors, and the PowerShell producer. I found six performance issues: three High (main-thread import parsing/memory, repeated package reparsing with sync I/O, serialized collector/network fan-out), two Medium (re-render/recompute churn and package-size contract mismatch), and one Low (avoidable O(77*n) lookup/stringify work in package generation).

## Findings

### High — Main-thread JSON import and payload duplication can freeze the UI and spike memory
- **Location:** `ai-flight-deck/index.html:1744,2710-2712,3134-3140,4372-4373,4409-4410`
- **Issue:** The UI permits up to 50 MB scan imports, then performs `await file.text()` + `JSON.parse(...)` on the main thread for tenant scans and verification reports. Evidence-package upload also wraps full file text inside another JSON payload (`{ kind, content: <full text> }`), creating extra copies and escaping overhead.
- **Impact:** For large artifacts, expected long tasks (seconds), frame drops, and memory peaks roughly 2–3x file size (raw text + parsed object + transport copy). This is user-visible latency and a responsiveness risk.
- **Confidence:** High
- **Fix:** Parse in a Web Worker and stream uploads as `multipart/form-data`/binary instead of embedding full JSON as a string field. Keep only one in-memory representation at a time.

### High — Evidence package adapters synchronously re-read and re-parse large JSON for every query
- **Location:** `ai-flight-deck/collector-adapters.js:34-37,85-96,121-133`; `ai-flight-deck/collectors/governance-domains.js:227-246`
- **Issue:** `readEvidenceFile()` uses `existsSync` + `readFileSync` + `JSON.parse` on each adapter call. Governance execution iterates plan queries one-by-one, so admin evidence can be reparsed repeatedly in one run.
- **Impact:** Scan-time regression proportional to package size × query count. On large `admin-evidence.json` payloads this adds avoidable CPU, disk I/O, and event-loop blocking.
- **Confidence:** High
- **Fix:** Load/validate each evidence package once per collector run, cache parsed doc (invalidate via mtime/hash), and reuse across queries.

### High — Collector fan-out is serialized where bounded concurrency is needed
- **Location:** `ai-flight-deck/collectors/graph-domains.js:965-975`; `ai-flight-deck/collectors/governance-domains.js:229`
- **Issue:** Teams collector loops up to 200 teams and awaits channels then owners sequentially per team. Governance `executePlan()` also executes independent queries serially.
- **Impact:** Latency scales linearly with round-trips. Example: 200 teams × 2 calls × 200 ms RTT ≈ 80 s just for channels/owners, before other collectors. Users will feel this as slow scans.
- **Confidence:** High
- **Fix:** Use bounded parallelism (`mapBounded`) for per-team detail fetches and for independent governance plan steps; preserve request budgets and cancellation.

### Medium — Repeated evidence/enablement recomputation causes avoidable O(77*n) and DOM churn
- **Location:** `ai-flight-deck/index.html:2400-2423,3014-3020,3214-3224,3257,3433-3442,3465,3478`; `ai-flight-deck/evidence-completion.js:208-210,224,229`
- **Issue:** Toggling one remediation triggers `updateForecast()` → `renderClearance()`, which rebuilds evidence completion and tenant enablement sections. `buildEvidenceCompletionPlan()` is called again inside enablement rendering, and summary counts use repeated `controls.filter(...)` passes.
- **Impact:** Unnecessary repeated O(77*n) work and full DOM rebuilds on each click; measurable UI sluggishness on lower-end devices.
- **Confidence:** High
- **Fix:** Memoize completion/enablement plans by `(baselineScan hash, cohort, permissions)` and perform a single-pass count aggregation. Separate lightweight forecast updates from heavy readiness re-renders.

### Medium — Producer can emit very large packages that exceed import API limits (and waste work)
- **Location:** `ai-flight-deck/scanner/collect-admin-evidence.ps1:66,73,76,111,114,117,167-168`; `ai-flight-deck/server.js:591`; `ai-flight-deck/index.html:3140`
- **Issue:** Admin collector uses `ResultSize Unlimited` / `Limit All` and serializes deep JSON, but server evidence-package import caps request bodies at 12 MB and UI sends file text inside JSON.
- **Impact:** Larger tenants can produce packages that fail import after expensive collection/export; repeated retries increase user wait and local resource usage.
- **Confidence:** Medium
- **Fix:** Align producer and importer contracts: either chunk/compress package uploads or enforce/export size budgets with clear preflight size telemetry before writing package files.

### Low — Action package generation does avoidable stringify/parse and repeated linear lookups
- **Location:** `ai-flight-deck/index.html:2642,2658-2663,4423`
- **Issue:** `actionPackagePayload()` stringifies, caller immediately parses it, and each selected action performs repeated `.find(...)` scans over domains/controls/results.
- **Impact:** Small today but unnecessary O(77*n) CPU/allocation overhead if many actions are selected.
- **Confidence:** High
- **Fix:** Return a plain object from builder functions, pre-index `domainId/controlId/controlResult` maps once, stringify only at final download/POST boundary.

## Lessons (appended to persona file)
- Added to `~/.copilot/personas/performance-reviewer.md`.
