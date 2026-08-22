# RabbitHole PDF Reader Layer 1 / Layer 1.1 — GLYPH → CHAR Technical Audit

Original audit date: 2026-08-21  
Layer 1.1 update date: 2026-08-21  
Repository state: working tree as inspected; Layer 1 and Layer 1.1 files are currently uncommitted in both `front` and `back` repositories.  
Current persisted contract: schema `6`, recognizer envelope `glyph-identity-fusion-v2`.  
Models: `rabbit-glyph-raster-fusion` `v2` and `rabbit-glyph-vector-fusion` `v2`.  
Validation profile: `layer1-real-pdf-unapproved-v1`; `approvedForDownstream=false`.  
Admission policy: `layer1-admission-v1`.

This is an implementation audit, not a design proposal. It now contains two evidence generations: the original schema-5 baseline and the current schema-6 Layer 1.1 reassessment. The **Layer 1.1 Current-State Reassessment** and explicitly revised passages supersede any conflicting schema-5 statement retained later for historical comparison. No schema-5 metric is presented as a schema-6 validation result. Statements are based on current source, exported artifacts, direct runtime tests, and local smoke measurements. Where the code cannot establish a fact—especially real-PDF model validity—the report says so.

## Layer 1 service and runtime-component inventory

Layer 1 is not one service. It is a browser client, an authenticated Node API/worker, a database and source-file store, and a Python extraction/inference microservice. The following inventory distinguishes independently running/networked services from in-process libraries. That distinction matters for authentication, failure recovery, deployment, and provenance.

### Independently running or network-accessed services

| Service | Current implementation and address | Layer 1 responsibility | Data crossing the boundary | Required? |
|---|---|---|---|---|
| RabbitHole frontend | React/Vite application in `front`; PDF workspace in `PDFPage.jsx`; Layer 1 client in `front/src/PDF/glyphChar` | Opens/renders PDF, starts/cancels/deletes analysis, polls/hydrates evidence, overlays glyph bboxes, displays stages/candidates/comparison, captures Human confirmation | JWT, document/job IDs, page requests, persisted glyph evidence, selected human label | Yes for interactive use |
| PDF.js worker delivery | `pdfjs-dist` 3.11.174 worker loaded at runtime from `cdnjs.cloudflare.com/ajax/libs/pdf.js/...` | Browser PDF parsing/rendering and fallback/local glyph evidence; page viewport used by the visual overlay | Browser requests executable worker code from a third-party CDN; PDF bytes are then processed in-browser by that worker | Yes in the current frontend configuration; externally hosted despite package installation |
| RabbitHole Express API | `back/server.js`, normally port 4000; routes mounted at `/api/glyph-char-analysis` | JWT/ownership boundary, job API, result pagination, human-label API, cancellation/deletion, worker startup/resume, source-buffer orchestration | Auth token, document/job parameters, Mongo evidence, source PDF bytes sent onward to Python on cache miss | Yes for persisted/background analysis |
| Layer 1 background worker | In-process module `back/services/GlyphCharAnalysisWorker.js` inside the Express process | Selects pages, invokes Python, batches every 10 pages, computes the central schema-6 admission decision, persists chunks/stages, resumes pending jobs | Full PDF buffer on Python cache miss; per-page extraction JSON; Mongo status/chunks/stages/admission | Yes for persisted/background analysis; not a separate queue service |
| MongoDB | Mongoose connection from `DB_CONNECTION_LOCAL`/`DB_NAME` | Stores users/source metadata, `PDFDocument`, Layer 1 jobs, page chunks, visual stages, human training samples, validation samples, and validation profiles | Source identity, decoded glyph evidence, masks/stages, model output, validation provenance, human assertions, admission, job state | Yes for persisted/background analysis |
| RabbitHole source-file store | Local/chunked storage resolved by `SourcesAPI.js::getSourcePdfBuffer()` and `helpers/localStorage.js` | Supplies the original saved PDF bytes to the worker; reconstructs chunked sources before analysis | Original PDF bytes | Yes for background analysis; a local unsaved PDF cannot start the durable job |
| PDF Structure FastAPI service | `back/pdf-structure/main.py`; default `http://127.0.0.1:8002`; Docker exposes 8002 | Caches PDF, extracts one page, performs forensics, builds Vector/Raster evidence, runs CNN inference, returns Layer 1 JSON | PDF upload keyed by document hash; page/request options; extracted page/glyph evidence | Yes for the current authoritative persisted pipeline |
| Python PDF disk cache | `PDF_CACHE_DIR`, default `back/pdf-structure/cache` or `./cache` in service working directory | Retains hash-named PDF files so every page does not require a re-upload | Full source PDF bytes | Operationally required by current service flow, but self-healed from Source storage after cache miss |

### In-process engines and libraries used by those services

| Component | Version observed | Process | Exact Layer 1 role | Service status |
|---|---:|---|---|---|
| PDF.js (`pdfjs-dist`) | 3.11.174 | Browser/worker | PDF display, viewport transforms, browser fallback extraction, overlay alignment inputs | Library plus externally delivered worker, not the authoritative persisted extractor |
| PyMuPDF (`fitz`) | 1.28.0 | Python service | Opens PDF, `get_texttrace()`, fonts/operators, page geometry/rotation, grayscale page raster, embedded-font extraction | Core authoritative extraction library |
| FontTools | 4.59.2 | Python service | Parses sfnt TrueType/OpenType, raw CFF, Type1, and obtainable CID descendant programs; extracts outlines and em-space metrics | Optional Vector channel; Type3 CharProc remains explicitly unavailable |
| OpenCV | 5.0.0 | Python service | Grayscale/mask processing, Otsu/adaptive thresholding, crop/normalize, contours/components/edges, pre-normalization geometry, and debug similarity | Core Raster preprocessing and measurement library; it does not choose Char identity |
| PyTorch/TorchScript | 2.13.0+cu130 observed locally | Python service | Loads independent Raster/Vector v2 fusion artifacts; consumes shape plus masked typographic features; emits closed-set candidates and explicit knownness/open-set evidence | Core identity recognizer; current artifacts are synthetic bootstrap models and are not approved downstream |
| NumPy | 2.5.1 observed | Python service | Image arrays and numerical interchange across OpenCV/model code | Supporting library |
| Pillow | 12.3.0 observed | Python training/evaluation tooling | Synthetic font rendering and augmentation for model construction/evaluation | Offline model-build dependency, not required for every production inference path |
| FastAPI/Uvicorn | 0.139.2 / 0.51.0 | Python service | HTTP service contract, upload/form/JSON endpoints, health and extraction calls | Service framework |
| Express | backend package dependency | Node process | Public authenticated REST boundary and middleware | Service framework |
| Mongoose | backend package dependency | Node process | Mongo schemas, ownership queries, chunks, indexes, status updates | Persistence client/ODM |
| JSON Web Token library | backend package dependency | Node process | Verifies the authenticated user for each Layer 1 route | Authentication library |

### Explicitly not used by the Layer 1 job

- Docling is installed in the Python service, but `GlyphCharAnalysisWorker.js` calls extraction with `runDocling:false` and `runOcrHint:"never"`. It is not part of current GLYPH → CHAR identity inference.
- Tesseract, Whisper, AI providers, Datamuse, TTS services, voice services, and semantic/meaning reconstruction services are not used by Layer 1.
- No external character-recognition API is called. Production recognition is local TorchScript inference.
- PDF.js is important to display/fallback behavior, but the persisted background pipeline’s Given/geometry/Raster source is PyMuPDF.
- MongoDB is persistence, not an inference source. Human labels stored there are joined after inference.

### Authoritative service path

```text
React/PDF.js Reader
    ↓ authenticated Layer 1 REST requests
Express API + in-process GlyphCharAnalysisWorker
    ↓ ownership-scoped Source/PDFDocument lookup
MongoDB + local/chunked Source file storage
    ↓ source PDF upload on Python cache miss
FastAPI PDF Structure service + hash-addressed PDF cache
    ↓
PyMuPDF extraction/rendering
    ├── FontTools Vector evidence
    └── OpenCV Raster evidence
             ↓
      independent local Raster/Vector TorchScript fusion models
             ↓
      explicit open-set assessment
             ↓
      central Layer 1 admission policy
             ↓
Express worker persistence → MongoDB chunks/stages/validation provenance/admission
             ↓ paginated hydration
React Layer 1 aside + glyph selection overlay
```

## Layer 1.1 Current-State Reassessment

This section is the authoritative audit delta for the current implementation. It supersedes conflicting schema-5 findings in the numbered baseline sections while retaining those findings as the history that motivated Layer 1.1.

### Current architecture and epistemic boundary

```text
Glyph Instance
│
├── Given evidence + mapping provenance
├── Vector evidence
│     ├── normalized outline shape
│     ├── embedded-font typographic metrics
│     ├── closed-set candidate distribution
│     └── independent open-set assessment
├── Raster evidence
│     ├── rendered pixels and OpenCV morphology
│     ├── pre-normalization typographic-relative geometry
│     ├── closed-set candidate distribution
│     └── independent open-set assessment
├── Human evidence
├── Measurement quality
├── Validation provenance
├── Evidence comparison
└── Layer 1 Admission Decision
      ├── OBSERVE_ONLY
      ├── REVIEW_REQUIRED
      ├── ELIGIBLE_WITH_PROVENANCE
      └── HUMAN_ASSERTED
```

The governing invariant is now executable rather than merely documented:

```text
prediction.predictedChar ≠ canonical Char
```

Downstream code has dedicated `getLayer1Admission(glyph)` and `getAdmittedChar(glyph)` accessors. The latter returns a value only for `ELIGIBLE_WITH_PROVENANCE` or `HUMAN_ASSERTED`. Repository search found no non-Layer-1 downstream consumer treating raw `predictedChar` as canonical Char.

### Version and artifact reassessment

| Contract | Current value |
|---|---|
| Schema | `6` |
| Recognizer envelope | `glyph-identity-fusion-v2` |
| Raster model | `rabbit-glyph-raster-fusion` `v2` |
| Vector model | `rabbit-glyph-vector-fusion` `v2` |
| Vocabulary | `latin-print-open-set-v2` |
| Preprocessing | `opencv-proportional-typographic-v3` |
| Typographic features | `typographic-relative-v1` |
| Open-set method | `explicit-knownness-energy-v1` |
| Calibration | `real-pdf-required-v2` |
| Validation profile | `layer1-real-pdf-unapproved-v1` |
| Admission policy | `layer1-admission-v1` |
| Raster artifact SHA-256 | `ded0244ce803a957d2683a4aa68c8f5022e1bd1ab3bd713079bc8e9a6dd2c372` |
| Vector artifact SHA-256 | `7531d6253ff61b5015689456838798a2dffe54266c649919078bec205871fc0b` |

The Raster and Vector artifacts currently share architecture and bootstrap training procedure, but they are operationally separable: distinct files, metadata, names, hashes, runtime channels, prediction sources, and cache identities. This removes the software requirement that both channels always share one model, although correlated errors remain possible because the initial training distributions are related.

### Typographic-relative evidence reassessment

Layer 1.1 retains normalized intrinsic shape and adds the evidence that tight normalization previously destroyed.

Raster evidence now preserves, where derivable:

- glyph bbox width and height relative to font size;
- raw crop dimensions relative to expected rendered font pixels;
- ink dimensions relative to expected rendered font pixels;
- baseline-relative top and bottom;
- origin as provenance, not page-position identity;
- source-quality and unavailable-reason arrays.

Vector evidence now preserves, where provided by the embedded font:

- units per em;
- advance width and advance/em;
- left and right side bearings and their em ratios;
- ascender and descender;
- x-height and cap-height;
- glyph top, bottom, width, and height relative to em;
- cap- or x-height ratio;
- provider and embedded-font-program provenance.

The fusion model receives 16 typographic values plus a 16-value availability mask. Missing evidence remains unavailable and is not represented as a legitimate zero. Absolute page number and page coordinates are not identity features. No previous/next character, word, dictionary, language, medical vocabulary, or semantic context enters either model.

### Recognition and open-set reassessment

`GlyphIdentityModel` combines:

```text
normalized shape → CNN encoder ┐
                               ├→ fusion → character head
masked typographic vector → MLP┘          → knownness head
```

The output separates the best closed-set candidate from vocabulary acceptance. A rejected specimen retains `closedSetTopCandidate` for inspection while ordinary `predictedChar` becomes `null`. Open-set states are:

- `IN_VOCABULARY`;
- `OUT_OF_VOCABULARY`;
- `OPEN_SET_UNCERTAIN`;
- `UNAVAILABLE`.

Training infrastructure now includes explicit non-vocabulary and corruption negatives: available Greek, Cyrillic, Arabic, Hebrew, mathematical/currency/arrow symbols, ligatures, blank crops, partial/clipped forms, overlaps, noise, and border fragments. The current knownness boundaries are synthetic bootstrap settings, not validated downstream thresholds. The UI correctly labels uncalibrated values as **Model score**, not probability correct.

### Font evidence and definition identity reassessment

The old definition key `fontName:glyphId` has been replaced on the authoritative backend path by:

```text
fontdef:<fontProgramSha256>:<fontXref>:<glyphId>
```

Fallback identities are prefixed and marked `definitionIdentityConfidence=fallback`. Vector caches and Human-definition scope use the stronger identity, preventing same-name/same-GID collisions from silently sharing evidence.

The provider architecture now includes:

| Font condition | Current state |
|---|---|
| sfnt TrueType | Implemented through FontTools |
| sfnt OpenType | Implemented where FontTools can parse the extracted wrapper |
| raw CFF | Dedicated `CFFFontSet` path implemented |
| Type1 | Isolated `T1Font` path implemented |
| CID/Type0 descendants | Dedicated provider attempts descendant sfnt then raw CFF while retaining resource provenance |
| Type3 | Explicitly detected; canonical CharProc rendering remains unavailable and no substitute font is used |
| Missing/malformed programs | Honest `Vector.available=false` with a precise reason |

Fixture breadth is still insufficient to claim broad production coverage for CFF, Type1, CID, or Type3.

### Given evidence reassessment

Given value remains unchanged evidence. Layer 1 now records resource-level mapping provenance using:

- `EXPLICIT_TOUNICODE`;
- `SIMPLE_FONT_ENCODING`;
- `PREDEFINED_CMAP`;
- `CID_MAPPING`;
- `EXTRACTOR_FALLBACK`;
- `UNKNOWN_MAPPING_PATH`.

The quality envelope records mapping path, whether `/ToUnicode` is explicit at resource level, raw-code availability, and provenance strength. PyMuPDF texttrace still does not expose the original encoded bytes per glyph, so `rawCode` remains unavailable instead of being invented. A resource-level `/ToUnicode` reference is not misrepresented as proof of a particular per-glyph byte mapping.

### Admission-policy reassessment

Admission is centralized in `back/services/layer1AdmissionPolicy.js`. It is not calculated by majority vote and is not spread across UI conditions.

| State | Meaning in the current implementation |
|---|---|
| `OBSERVE_ONLY` | Evidence may be inspected and stored but no Char is admitted downstream |
| `REVIEW_REQUIRED` | An approved policy exists, but disagreement, ambiguity, domain, geometry, or open-set evidence blocks automatic admission |
| `ELIGIBLE_WITH_PROVENANCE` | Machine Char passed an explicitly approved validation profile, in-domain checks, open-set acceptance, validation-derived score/margin policy, and channel-agreement rules |
| `HUMAN_ASSERTED` | A user explicitly asserted a Char; original Given/Vector/Raster evidence remains unchanged |

The current profile is not approved. Therefore every machine result is currently `OBSERVE_ONLY` regardless of a high model score. Only explicit Human confirmation can currently create an admitted Char, under `HUMAN_ASSERTED`.

Machine-readable reason codes include `NO_APPROVED_VALIDATION_PROFILE`, `OUT_OF_VOCABULARY`, `OPEN_SET_UNCERTAIN`, `RASTER_AMBIGUOUS`, `VECTOR_AMBIGUOUS`, `VECTOR_RASTER_DISAGREEMENT`, `PDF_VISUAL_DISAGREEMENT`, `TYPOGRAPHIC_FEATURES_MISSING`, `MULTI_CHAR_GLYPH`, and `NO_VISIBLE_GLYPH`.

### Validation and model-governance reassessment

Layer 1.1 adds infrastructure for a real-PDF corpus but does not pretend that infrastructure is evidence of validity:

- `Layer1ValidationSample` separates production evidence from adjudicated labels;
- partitions are explicit: `TRAIN`, `VALIDATION`, `TEST`, `REAL_DOCUMENT_FINAL_TEST`, and `HUMAN_CORRECTION_MEMORY`;
- governance permission basis and corpus version are required when capturing samples;
- reviewer records are independent; agreement by distinct reviewers can resolve a sample;
- metrics code covers top-1/top-3, selective accuracy, coverage/risk curve, ambiguity/unpredictable rates, open-set FAR/FRR, per-character scores, confusion and case-confusion matrices, font/render strata, channel availability/agreement, and calibration placeholders;
- `validate_layer1_model.py` freezes hashes, versions, source corpus, thresholds, and Git/dirty-worktree provenance into a profile;
- `approve_layer1_profile.py` is a deliberate gate and refuses approval without measured, versioned real-PDF evidence and both artifact hashes.

Current real-document corpus status:

```text
documents: 0
adjudicated glyphs: 0
top-1/top-3: unavailable
selective accuracy/coverage: unavailable
open-set FAR/FRR/AUROC: unavailable
calibration: unavailable
approvedForDownstream: false
```

The prior schema-5 synthetic and PyMuPDF-generated benchmark numbers remain historical diagnostics only. They must not be attributed to the v2 models or used to promote schema 6.

### API, persistence, and UI reassessment

Schema-6 jobs persist the recognizer/model/vocabulary/open-set/preprocessing/typographic/calibration/validation/admission versions plus model and metadata hashes. Glyph records preserve existing Given/Vector/Raster/Human/comparison fields and add typographic evidence, open-set assessment, measurement quality, validation provenance, and a typed admission decision. Schema-5 jobs are excluded from schema-6 lookup identity.

The API now exposes admission with results, a conservative validation profile, validation sample capture/listing, and independent adjudication. Human confirmation hydration adds actor, time, definition scope, and occurrence identity and then recomputes admission without rewriting historical model output.

The existing GLYPH → CHAR aside now displays:

- closed-set candidate separately from open-set status;
- Measurement Validity;
- exact Raster/Vector model identities;
- validation profile and approval state;
- typographic-evidence availability and details;
- admission state, admitted Char, and reason codes;
- **Evidence agreement** instead of presenting `MATCH` as correctness.

### Updated procedural functionality worldline

1. The user explicitly starts document or page analysis; opening/reloading does not auto-start it.
2. The worker resumes complete checkpoints, obtains the immutable source hash/PDF, and requests a bounded page extraction.
3. PyMuPDF records independent PDF-source evidence: extracted Unicode, glyph ID, bbox, font resource, and mapping provenance. Unavailable raw bytes remain unavailable.
4. The Vector path resolves program hash+xref+GID identity, selects a font provider, and extracts canonical shape plus em-space metrics or a precise unavailable state.
5. The Raster path renders one bounded grayscale page, crops the actual occurrence, runs OpenCV morphology, and records geometry before tight normalization.
6. Raster and Vector models independently consume normalized shape plus masked typographic-relative features. Neither receives Given Char or semantic context.
7. Each model emits a closed-set candidate distribution and a separate knownness/open-set assessment. Rejection prevents an ordinary predicted Char while retaining audit candidates.
8. Layer 1 computes visibility, sequence state, measurement quality, and evidence agreement without voting any channel into truth.
9. The exact validation profile and artifact provenance are attached.
10. The central admission policy evaluates the evidence. With the current unapproved profile, all machine evidence becomes `OBSERVE_ONLY`.
11. The worker separates visual stages, chunks glyph evidence, saves all-document checkpoints every ten pages, records performance timings, and remains cancellable/resumable.
12. Reload hydration is page-bounded; Human assertions are joined independently and admission is recomputed without mutating Given/Vector/Raster history.
13. The UI presents each evidence channel, uncertainty, measurement validity, and admission separately.
14. Any future Layer 2 consumer must use the admission accessor, never raw model prediction.

### Verification and measured runtime status

- Python Layer 1 regression suite: **10/10 passing**.
- Covered properties include evidence-channel separation, Given independence, nonfatal model/OpenCV failure, schema-6 provenance, open-set envelope, typographic feature flow into the model, strong font-definition collision resistance, and default downstream blocking.
- Direct Node assertions confirm unapproved machine blocking and approved-policy mechanics.
- Frontend/backend package test runners were unavailable in the active installation, so their source suites were not fully executed.
- A local same-process smoke page containing 18 glyphs measured cold total 5.796 s and warm total 0.246 s; process peak RSS was 656,740 KiB. These are development-machine smoke figures, not corpus validity or production-capacity measurements.

### Current Layer 1.1 audit verdict

Layer 1.1 materially improves the **instrument contract**: it measures case-relevant geometry, supports explicit unknowns, freezes artifact provenance, strengthens definition identity, preserves source distinctions, and technically prevents unapproved model output from becoming downstream Char. It does **not** establish model validity. The v2 artifacts are short synthetic bootstrap exports; no adjudicated natural-PDF corpus exists; real-document selective risk, calibration, script/font coverage, and clinical safety remain unknown. The current safe product posture is therefore:

```text
Machine evidence → OBSERVE_ONLY
Explicit Human evidence → HUMAN_ASSERTED
Machine Layer 2 eligibility → BLOCKED pending approved real-PDF validation
```

## 1. Executive summary

Layer 1 asks a deliberately narrow question for each PDF glyph occurrence:

> What character does the isolated visual evidence support, and how does that evidence compare with the character mapping reported by the PDF extractor?

It does not reconstruct words, infer language, consult dictionaries, use neighboring characters, repair the PDF, or decide semantic meaning. It produces four separate evidence channels:

| Channel | Source | Current role | Authoritative truth? |
|---|---|---|---|
| Given Char | PyMuPDF `Page.get_texttrace()` Unicode/codepoint output | Records what the PDF/PyMuPDF extraction path reports | No |
| Vector | Embedded font bytes + PyMuPDF glyph ID, parsed by FontTools | Reconstructs a reusable glyph definition and classifies its canonical outline mask | No |
| Raster | Actual page rendered by PyMuPDF, cropped at the text-trace bbox, preprocessed by OpenCV | Classifies the visible glyph instance | No |
| Human Confirmation | Explicit user-entered one-code-point label | Stored separately with actor/time/scope/definition/instance provenance; recomputes admission without rewriting machine history | Explicit authority only as `HUMAN_ASSERTED`; never retroactive model truth |

The current production-shaped recognizer contract is a 93-class, multi-input PyTorch fusion architecture exported as two independent TorchScript artifacts. Raster and Vector each receive normalized shape plus a masked typographic-relative feature vector and each emit a closed-set candidate distribution plus explicit knownness/open-set evidence. Their source evidence and artifact identities are independent; the initial bootstrap models may still have correlated errors because they share architecture and related synthetic training data.

OpenCV does not choose the production character. It creates and measures masks. Legacy Dice/IoU/`cv2.matchShapes` outputs are still calculated and persisted under `morphologicalSimilarity`, but are marked `debugOnly: true` and do not select `predictedChar`.

The current system is a safer evidence instrument but is not a validated character oracle:

- The historical schema-5 benchmark numbers are not v2 validation results and cannot promote schema 6.
- Typographic-relative evidence now addresses the architectural cause of many uppercase/lowercase collapses, but real-PDF S/s and related confusion rates have not yet been remeasured.
- Raw CFF, Type1, and CID providers now exist; Type3 remains explicitly unsupported, and fixture/corpus coverage is insufficient for broad support claims.
- Open-set recognition can reject unsupported specimens instead of forcing a Latin class, but FAR/FRR/AUROC are unmeasured on adjudicated natural PDFs.
- Model output is labelled **Model score** because real-document calibration is unavailable.
- Artifact hashes, dirty-worktree provenance, validation profile, and admission policy are persisted.
- The validation profile is explicitly unapproved. Therefore a machine `predictedChar`, however high its score, produces `OBSERVE_ONLY` with `admittedChar=null`.
- The current smoke benchmark demonstrates a large warm-cache benefit but is not production capacity evidence.

Layer 1 preserves disagreement instead of voting it away and now enforces the Layer 1 → Layer 2 boundary in code. Recognition quality, open-set validity, calibration, font/script coverage, Type3 support, corpus governance, and operational robustness remain insufficient for machine admission. Only explicit Human assertion is currently eligible downstream.

## 2. Complete end-to-end pipeline

### 2.1 Saved PDF, current authoritative path

```text
User opens saved Source-backed PDF
  ↓
PDFPage resolves stable PDFDocument ObjectId
  ↓
User explicitly starts all-document or one-page analysis
  ↓
POST /api/glyph-char-analysis/documents/:documentId/start
  ↓
MongoDB GlyphCharAnalysisJob queued
  ↓
GlyphCharAnalysisWorker chooses one uncompleted page
  ↓
Node calls pdf-structure /extract-page with:
  run_docling=false, run_ocr_hint=never,
  run_forensics=true, run_glyph_char=true
  ↓
FastAPI starts one child process for that page
  ↓
PyMuPDF native extraction + forensic text trace/font inventory
  ↓
glyph_char_analysis.analyze_page()
  ├─ page render: grayscale, up to 4×, 12,000,000-pixel target cap
  ├─ per occurrence: Given + provenance, bbox, glyph ID, raster crop
  ├─ per definition: strong identity + embedded-font provider/outline attempt
  ├─ OpenCV preprocessing/morphology + pre-normalization geometry
  ├─ independent Raster/Vector fusion inference
  ├─ closed-set candidates + open-set knownness assessment
  ├─ measurement quality and evidence agreement
  └─ unapproved Python-side safe admission envelope
  ↓
Node removes stage PNGs from glyph chunks
  ├─ stage PNGs → GlyphCharVisualStage
  └─ schema-6 glyphs, validation provenance, typed admission,
     performance, and vector definitions → GlyphCharAnalysisPage
  ↓
Central Node admission policy recomputes the authoritative API decision
  ↓
Job counters/progress recomputed from complete page chunks
  ↓
Frontend polls two saved pages at a time
  ↓
Glyph instances + definition records hydrated into the GLYPH → CHAR aside
  ↓
Selecting a glyph lazily fetches its OpenCV stage images and displays
typographic/open-set/validation/admission evidence
  ↓
Clicking a result navigates to the page and overlays its bbox
```

Document scope processes pages sequentially within a job and holds up to ten completed page results in Node memory before saving them. Page scope saves the requested page immediately and then returns `partial` unless every document page is already complete.

### 2.2 Unsaved/local PDF fallback

The browser can extract PyMuPDF evidence if an associated Source exists, otherwise it falls back to PDF.js `getTextContent({ disableCombineTextItems: true })` and local canvas crops. However, `visualGlyphRecognizer.js` intentionally returns `status: "unavailable"`; it no longer uses browser template matching for identity. Therefore an unsaved PDF can expose occurrences and crops but cannot receive current neural character predictions.

### 2.3 Reload and background behavior

- MongoDB stores jobs and page checkpoints.
- Express calls `resumePendingGlyphCharAnalysisJobs()` after MongoDB opens. `processing` jobs are reset to `queued`; both queued and formerly-processing jobs are scheduled.
- The frontend does not auto-start analysis. With no active request it performs a read-only GET for a current-version job and hydrates only the current page if saved.
- A background job can continue without the reader page mounted because the worker is server-side.
- A server crash can lose up to the current ten-page in-memory document batch; those pages are reprocessed after restart because only `complete: true` pages count as checkpoints.

> **Historical-baseline note for sections 3–90:** These detailed dimensions began as a schema-5 audit. They remain useful for unchanged extraction, operations, security, and governance concerns. Where they mention schema 5, the v1 CNN, one shared classifier, font-name definition keys, forced closed-set output, old confidence/calibration, missing admission, or missing artifact hashes, the Layer 1.1 reassessment above is authoritative. Historical benchmark values remain labelled baseline evidence and are not v2 validation.

## 3. Source PDF extraction

### 3.1 Libraries and calls

The Python service pins PyMuPDF `1.28.0`. Relevant calls are:

- `fitz.open(path)` — opens the cached original PDF.
- `Page.get_texttrace()` — returns text spans and tuples whose positions are interpreted as `(Unicode codepoint, glyph ID, origin, bbox)`.
- `Page.get_fonts(full=True)` — inventories page font resources.
- `Document.xref_get_key()`, `xref_object()`, and `xref_stream()` — inspect font dictionaries and raw page content streams.
- `Page.get_contents()` — lists content stream xrefs.
- `Document.extract_font(xref)` — obtains embedded font bytes for vector analysis.
- `Page.get_pixmap()` — renders the actual page for Raster evidence.

`forensic_analysis._text_trace()` emits:

```text
traceIndex, sequenceNumber, fontName, fontSize, fontFlags, fontType,
writingMode, direction, rotation, span bbox, opacity, spaceWidth,
lineWidth, and characters[]
```

Each character record contains:

```text
characterIndex, spanCharacterIndex,
rawCode=null, rawCodeHex=null,
unicode, unicodeCodepoint, unicodeCodepointValue,
glyphId, glyphName=null,
origin, bbox,
explicitInPdf=true,
source="pymupdf_texttrace"
```

### 3.2 What is actually available

- Unicode/codepoint: available when PyMuPDF exposes a valid codepoint.
- Glyph ID: available from the second text-trace tuple field.
- Origin and bbox: available and transformed by `page.rotation_matrix`.
- Font name/size/direction: available at span level.
- Original encoded character code: not available; deliberately stored as `null`.
- Glyph name: not available from text trace; only later recovered from a successfully parsed font program.
- Per-glyph transform: not populated by the Python forensic extractor, so current saved glyphs store `transform: null`.

The service also lexes PDF text operators (`BT`, `ET`, `Tj`, `TJ`, `'`, `"`, `Tf`, `Tm`, `Td`, `TD`, `T*`, `Tc`, `Tw`, `Tz`, `TL`, `Ts`, `Tr`) and preserves bounded operands/raw strings. Those records are forensic evidence only. Layer 1 does not associate a raw `Tj`/`TJ` byte sequence with a specific text-trace glyph and does not use operators in recognition.

### 3.3 `/ToUnicode`, CMaps, and encodings

For each font xref, `_fonts()` records the raw `ToUnicode` xref key, encoding field, descendant-font reference, font descriptor, and a bounded raw dictionary. `analyze_page()` reduces that to page-level `toUnicodeDetected: true/false`.

The current implementation does not:

- parse a `/ToUnicode` CMap;
- report which glyph used which CMap entry;
- expose original encoded bytes per glyph;
- prove whether a particular PyMuPDF Unicode value came from `/ToUnicode`, a built-in encoding, a CID map, or fallback logic.

PyMuPDF may internally use those PDF resources to produce the codepoint returned by `get_texttrace()`, but RabbitHole cannot distinguish that decision. `/ToUnicode` is detected, not consumed by either visual recognizer and not treated as a training label.

### 3.4 Extraction bounds

- Maximum text-trace characters per page: 50,000.
- Maximum preserved text operators: 2,000.
- Maximum combined operator payload: 2,000,000 characters.
- Maximum ordinary operand: 1,200 characters.
- Maximum raw text operand/array: 6,000 characters.

Truncation flags exist for text trace and operators, but Layer 1 does not surface a dedicated warning in the aside when glyph extraction was truncated.

## 4. Given Char

For the saved path, Given Char is built only after visual inputs have been formed:

```python
given_value = character.get("unicode")
given_values = list(given_value) if given_value is not None else []
```

The persisted provenance is:

```json
{
  "value": "E",
  "values": ["E"],
  "source": "pymupdfTextTrace",
  "rawCode": null
}
```

The current text-trace helper returns either one Python character or `None`, so saved backend `values` is effectively length zero or one. It cannot currently represent a single PDF glyph mapped to a multi-code-point string.

Given Char is not ground truth. It is PyMuPDF's decoded PDF mapping evidence. It can be wrong because the PDF's encoding/CMap is wrong, absent, custom, malformed, or interpreted through fallback behavior. It is used only in comparison after visual prediction.

The local fallback uses either PyMuPDF raw-dictionary characters (`source: pymupdfRawDict`) or a PDF.js text item (`source: textContent`). A combined PDF.js item remains one uncertain occurrence; the code explicitly refuses to invent equal-width per-character boxes.

## 5. Glyph Instance data model

**Layer 1.1 revision:** The schema-6 persisted glyph envelope now explicitly includes `given.provenance`, `given.quality`, `sequenceStatus`, `definitionIdentityConfidence`, `typographicEvidence`, `openSetAssessment`, `measurementQuality`, `validationProvenance`, and `admissionDecision`. `GlyphCharAnalysisPage` now uses a reusable glyph sub-schema and a strict typed admission sub-schema with an admission-state enum, reason codes, policy/profile versions, evidence snapshot, and model versions. Some deeply variable morphology/provenance fields remain `Mixed`; the original blanket statement that the glyph array itself is entirely untyped is no longer current.

There is no single typed interface. The runtime/persisted object is a Mongoose `Mixed` value created in Python and augmented in the frontend. Current saved-path fields are:

| Group | Fields |
|---|---|
| Identity | `id`, `pageNumber`, `instanceIndex`, `traceIndex` |
| Font | `fontName`, `fontRef`, `fontSize`, `glyphId`, `sourceGlyphCode` |
| Geometry | `bbox {x,y,width,height}`, `transform`, `geometryConfidence`, `geometryMethod`, `visible` |
| Keys | `visualFingerprint`, `definitionCacheKey`, `resolvedCacheKey` |
| Given | `given {value,values,source,rawCode}` |
| Raster result | `prediction`, `comparison`, `analysisStatus` |
| Multi-channel result | `visualEvidence {vector,raster}`, `evidenceComparison` |
| Hydration-only | prefixed frontend `id`, `serverGlyphId`, `documentId`, `renderedCrop`, `normalizedCrop`, optional `humanConfirmation`, stage-loading fields |

Python IDs are page-local strings such as `p7:g3`. Frontend hydration converts this to `<documentId>:p7:g3` and retains `serverGlyphId: "p7:g3"` for API calls.

The database does not validate the nested object contract. Schema drift inside `glyphs: [Mixed]` is prevented only by job-level schema/recognizer version filtering, not by Mongoose field validation.

## 6. Glyph Definition versus Glyph Instance

**Layer 1.1 revision:** The authoritative definition reference is now `fontdef:<fontProgramSha256>:<fontXref>:<glyphId>`. The page dictionary is keyed after Vector analysis resolves that identity, so the historical same-name/same-GID collision described below is corrected for embedded programs. Browser/local fallback keys are visibly prefixed `fontdef-fallback:` and carry fallback confidence. Human definition-level propagation uses this stronger key. Document-global unique-definition counting remains approximate.

A Glyph Instance is one occurrence on one page. Its bbox, rendered crop, threshold result, fingerprint, and Raster prediction are instance evidence.

A Glyph Definition is intended to be the reusable `(font, glyph ID)` shape. On each page, Python builds `vectorDefinitions` and stores only a lightweight reference inside each instance:

```text
definitionRef = "<fontName>:<glyphId>"
instance.visualEvidence.vector.definitionRef = definitionRef
```

The definition record contains font xref, glyph name, outline, vector morphology, Vector recognition, debug similarity, and vector cache key.

Important limitations:

- `definitionRef` and `definitionCacheKey` use normalized text-trace font name plus glyph ID, not font-program hash. Two distinct font resources with the same exposed name and glyph ID can collide; the first page-local definition wins.
- `_analyze_definition()` internally uses `(font SHA-256, glyph ID, fontRef, xref)` and is safer, but the outer page dictionary can prevent the second colliding definition from reaching it.
- Job `uniqueDefinitions` is the sum of page-level counts. The same definition on 100 pages can be counted 100 times. It is not a document-global cardinality.
- Human confirmations are propagated by `definitionCacheKey`; a collision can therefore display a confirmation on an unrelated same-name/same-ID font definition.

## 7. Geometry and coordinates

PyMuPDF text-trace coordinates begin in the page's unrotated content coordinate space. `forensic_analysis._point()` and `_bbox()` multiply them by `page.rotation_matrix`; bboxes then align with the rotation-normalized `page.rect`. The resulting coordinate system is in PDF points with a top-left-oriented PyMuPDF page space.

Saved-path geometry is labeled:

```text
geometryConfidence = "exact"
geometryMethod = "pymupdf-texttrace-glyph-bbox"
```

“Exact” means directly supplied by PyMuPDF text trace, not that the box is guaranteed to contain all and only visible ink. A font bbox can include side bearings, overlap neighbors, clip marks, or lie partly outside the page. In a real audit sample, `p1:g1242` had `y=805.82434` on a page only `783.04797` points high; its raster crop was empty even though Vector evidence existed.

The backend raster crop multiplies bbox coordinates by render scale, floors left/top, ceils right/bottom, and clips to pixmap bounds. It adds no padding. The browser-only renderer adds `max(3, ceil(scale*1.5))` pixels of padding, so local and saved crops are not identical.

The frontend overlay simply multiplies `x`, `y`, `width`, and `height` by the current PDF.js viewport scale. Clicking converts the page-container client position back to unscaled document coordinates and chooses the smallest-area bbox containing the point. No equal-width character splitting is performed.

Rotation, crop-box differences, unusual PDF user-unit values, CSS transforms, and page-container padding do not have dedicated Layer 1 integration tests. The overlay zoom test covers scale only.

## 8. Vector morphology source

**Layer 1.1 revision:** Steps 5–7 below describe only the old sfnt-only route. Current provider dispatch supports sfnt, raw CFF, Type1, and obtainable CID descendants. Each provider returns outline plus available font metrics; Type3 is detected and returns a precise unsupported CharProc reason. Vector inference now consumes canonical shape plus masked em-space typographic evidence.

`vector_glyph_evidence.analyze(document, forensic_fonts, font_name, glyph_id)` receives no Given Char. It:

1. Normalizes subset prefixes and punctuation from font names for matching.
2. Matches the text-trace font name against `baseFont`, `resourceName`, or `embeddedName` in the forensic inventory. (`embeddedName` is currently always `null`.)
3. Calls `document.extract_font(xref)` and takes tuple element `3` as font bytes.
4. SHA-256 hashes those bytes.
5. Opens them with `fontTools.ttLib.TTFont(BytesIO(...), lazy=False, recalcBBoxes=False, recalcTimestamp=False)`.
6. Treats PyMuPDF `glyphId` as an index into `font.getGlyphOrder()`.
7. Draws the glyph through a custom `_SamplingPen` and a `RecordingPen`.

No PDF Unicode, `/ToUnicode`, Given Char, neighboring text, or raster crop is passed into the vector recognizer. The function does receive the full forensic font dictionaries, which contain `toUnicode`, but `_matching_font()` reads only naming fields.

## 9. Font support

**Layer 1.1 revision:** The table below is the schema-5 baseline. Current support is: sfnt TrueType/OpenType implemented; raw CFF implemented with `CFFFontSet`; Type1 implemented with `T1Font`; CID/Type0 descendant extraction attempts sfnt then raw CFF; Type3 is explicitly detected but CharProc rendering is unimplemented. These paths still need representative fixtures and measured real-PDF coverage before broad support claims.

| Font condition | Current status | Evidence |
|---|---|---|
| Embedded sfnt TrueType (`.ttf`) | Supported when name match and glyph ID are valid | Python regression fixture and real embedded Helvetica example |
| Full OpenType sfnt with `glyf` or CFF table | FontTools should parse it, but no dedicated Layer 1 test proves both paths | Conditional/insufficiently validated |
| Raw CFF extracted from PDF Type1/CFF | Not supported by current `TTFont` call | Real Myriad Pro returned `bad sfntVersion` |
| Classic Type1 program | Unsupported unless extraction happens to yield a FontTools-readable sfnt wrapper | No adapter exists |
| Type3 font | Unsupported | No extractable sfnt glyph set/path adapter |
| CID/Type0 composite font | Conditional; only works if matching resolves and extracted descendant bytes form a valid sfnt with compatible GIDs | No dedicated test; cached Generic0 CID pages are not validated |
| Subset font | Name matching strips a six-letter `ABCDEF+` prefix; otherwise same conditions apply | Implemented by `_font_key()` |
| Standard/non-embedded font | Vector unavailable | No font bytes; there is no substitution for production Vector evidence |
| TTC/OTC collection | Not explicitly handled | `TTFont` is opened without a collection/font-number policy |
| Variable font | Parsed at default location if FontTools supports it; no PDF variation-coordinate extraction | Not validated |

Vector unavailability is a valid result and does not stop Raster analysis.

## 10. Outline representation

The custom `_SamplingPen` records contours as arrays of floating-point points and parallel `closed` flags:

- `moveTo`: starts a contour.
- `lineTo`: appends the endpoint.
- cubic `curveTo`: samples ten equal-parameter steps.
- quadratic `qCurveTo`: samples ten equal-parameter steps.
- `closePath`/`endPath`: marks closed/open.

`RecordingPen` retains original command names only long enough to count line and curve operations. Persisted `outline.svgPath` is not the exact font Bézier program; it is a polyline approximation made from sampled points, with `M`, repeated `L`, and optional `Z`. Y is inverted for SVG display. The persisted record includes `viewBox: "0 0 100 100"`, raw bounds, normalized bounds, glyph name, and morphology, but not the raw command list or contours.

Composite glyph handling is delegated to FontTools' glyph set drawing. Hinting, kerning, PDF text transforms, variation axes, fill rules, and rasterizer hinting are not represented.

## 11. Vector normalization

**Layer 1.1 revision:** Shape normalization remains as described, but it no longer constitutes all model evidence. Raw em-space bounds, advance, side bearings, ascender/descender, x-height/cap-height, and dimension/em ratios are retained independently and supplied through the typographic feature vector and availability mask.

`_normalize_outline()` computes the min/max of all sampled points, then:

```text
width  = maxX - minX
height = maxY - minY
scale  = 1 / max(width, height)
offsetX = (1 - width*scale) / 2
offsetY = (1 - height*scale) / 2
```

Every point receives the same scalar scale in X and Y, so aspect ratio is preserved. The normalized ink bbox is centered in a unit square. Side bearings and advance-width placement are not used in the mask; `advanceWidth` is retained only as a feature/debug value.

The normalized contours are then rasterized to 96×96 with a nominal four-pixel inset. Closed contours are filled according to whether their signed area matches the largest contour's sign. This is a heuristic fill rule: fonts with inconsistent winding, nested islands, self-intersection, or multiple outer contours can be filled incorrectly.

Normalization can distort evidence even without anisotropic scaling:

- curve sampling replaces exact curves with polygons;
- coordinate quantization occurs at 96×96;
- bbox normalization removes absolute size, baseline, cap-height, x-height, and side-bearing clues;
- very thin or tiny shapes are enlarged to nearly the same extent as large letters;
- case pairs with geometrically similar normalized outlines can become indistinguishable.

## 12. Vector morphology features

**Layer 1.1 revision:** The historical table lists shape/debug fields. Schema 6 additionally computes and feeds `advanceWidthToEm`, `leftSideBearingToEm`, `rightSideBearingToEm`, `glyphTopToEm`, `glyphBottomToEm`, `glyphWidthToEm`, `glyphHeightToEm`, and `capOrXHeightRatio`, with source quality and unavailable reasons. The “Used by classifier? No” entries below apply only to the legacy scalar morphology fields, not these new typographic features.

Only these features are currently calculated:

| Field | Calculation | Retained for | Used by classifier? |
|---|---|---|---|
| `contourCount` | Number of sampled contours | UI/debug | No |
| `closedContourCount` | Count of `closePath` contours | UI/debug | No |
| `openContourCount` | Count of `endPath` contours | UI/debug | No |
| `counterEstimate` | Child contours from `cv2.findContours(mask, RETR_CCOMP)` | UI/debug | No |
| `curveCount` | RecordingPen operations named `curveTo` or `qCurveTo` | UI/debug | No |
| `lineSegmentCount` | RecordingPen `lineTo` count | UI/debug | No |
| `sampledPointCount` | Total points after curve sampling | Persisted debug | No |
| `aspectRatio` | raw sampled bounds width/height | UI/debug | No |
| `advanceWidth` | FontTools glyph width | Persisted debug | No |
| `rawBounds` | min/max sampled font coordinates | Outline metadata | No |
| `normalizedBounds` | centered unit-square bounds | Outline metadata | Indirectly describes mask |

There is no explicit symmetry, stroke, Euler characteristic, topology graph, winding-depth, or baseline feature.

## 13. Vector character recognition

**Layer 1.1 revision:** Replace `rabbit-glyph-cnn v1` in the historical flow below with independent `rabbit-glyph-vector-fusion v2`: canonical mask plus masked typographic-relative metrics enter the fusion model, which returns a closed-set distribution and explicit knownness/open-set assessment. Open-set rejection sets ordinary `predictedChar` to null while retaining the nearest closed-set candidate for audit.

### Current method

```text
actual embedded font bytes + actual glyph ID
  ↓ FontTools
sampled outline
  ↓ proportional unit-square normalization
96×96 filled canonical mask
  ↓ resize to 64×64
rabbit-glyph-cnn v1
  ↓ temperature-scaled softmax
top-5 + status
```

Thus Vector Predicted Char is neural, not template-selected. The same 93-class CNN used by Raster is used here. The candidate bank is the CNN vocabulary, not a runtime font bank.

### Legacy/debug method

`_reference_bank()` still builds masks for the 93 candidates from exactly three host font paths when present:

```text
/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf
/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
```

For each character it takes the best `0.7*Dice + 0.3*IoU` score. `_predict()` converts score/margin into a heuristic result. `_analyze_definition()` does not use that result as recognition; it stores only nearest template and score under `morphologicalSimilarity.method = "legacy-vector-mask-overlap"`, `debugOnly: true`.

The old method was reference-font overlap. The new method canonically rasterizes the actual outline and uses the trained CNN. There is no character-specific override or majority vote.

## 14. Raster morphology source

Raster evidence comes from an actual PyMuPDF rendering of the full PDF page:

```python
page.get_pixmap(
  matrix=fitz.Matrix(render_scale, render_scale),
  colorspace=fitz.csGRAY,
  alpha=False
)
```

`render_scale` is `min(4.0, sqrt(12,000,000 / pageAreaInPoints))`, bounded below by `0.25`. Typical pages use 4×. The page is grayscale; transparency is flattened by PyMuPDF because alpha is disabled.

The exact text-trace bbox is converted to integer pixel bounds with floor/ceil and clipped. No padding is added. Therefore:

- anti-aliased edge pixels outside the reported bbox can be clipped;
- neighboring ink is included if it lies inside an overlapping/loose bbox;
- overlapping glyphs are not separated by connected-component ownership;
- clipping at page bounds can yield an empty or partial crop;
- colored text is represented only through grayscale luminance.

The 12-million-pixel formula budgets the rendered page, not all per-glyph stage PNGs or Node's ten-page pending batch.

## 15. Raw raster pipeline

The actual order is:

```text
PyMuPDF grayscale page pixels
→ exact bbox crop
→ reject absent/flat crop (dynamic range < 4)
→ 3×3 Gaussian blur (observation + one candidate only)
→ median border-background estimate from unblurred crop
→ three threshold candidates
→ heuristic candidate-quality selection
→ all nonzero foreground pixels
→ one union tight bounding rectangle
→ proportional resize into 80×80 maximum ink region
→ center in black 96×96 canvas
→ threshold resized values at 96 to binary white-on-black
→ contours/components/edges/features
→ resize to 64×64 float tensor in [0,1]
→ TorchScript CNN
```

| Step | Call/parameter | Purpose | Destructive risk/fallback |
|---|---|---|---|
| Blur | `cv2.GaussianBlur(gray,(3,3),0)` | suppress antialias/noise for one Otsu candidate | can merge/remove thin details; other candidates use unblurred gray/contrast |
| Border contrast | `absdiff(gray, medianBorder)` then Otsu binary | color/polarity-independent distance from border | fails if border contains glyph/neighbor or background is nonuniform |
| Polarity Otsu | blurred image, binary-inverse if border ≥127 else binary | conventional dark/light text split | one global threshold can fail gradients |
| Adaptive | Gaussian adaptive, odd block `3..31`, `C=3` | local nonuniform-background candidate | can create border/noise components |
| Candidate choice | `_candidate_quality()` | prefer plausible occupancy and clean border | heuristic target foreground ratio 0.18; no learned quality model |
| Tight crop | `findNonZero` + `boundingRect` | remove surrounding background | retains all components, including noise/neighbor ink |
| Resize | `INTER_AREA` down, `INTER_CUBIC` up | preserve aspect while fitting | alters stroke weights; tiny marks are greatly enlarged |
| Re-binarize | `>=96` | deterministic mask | discards resized grayscale/antialias values |
| Contours | `RETR_CCOMP`, `CHAIN_APPROX_SIMPLE` | morphology/debug | no effect on identity input |
| Edges | `Canny(60,180)` | edge percentage/preview | no effect on identity input |

If preprocessing returns `None`, Raster evidence is `unavailable` with reason `No visible foreground pixels were isolated.` If the CNN fails, morphology remains available while recognition becomes `unavailable`.

## 16. Otsu and thresholding

Otsu is used because it chooses a global split without a manually fixed intensity threshold. The implementation does not trust one Otsu result; it compares three masks:

1. `border-distance-otsu`: absolute difference from median border intensity, `THRESH_BINARY + THRESH_OTSU`.
2. `polarity-aware-gaussian-otsu`: 3×3 blurred grayscale; `THRESH_BINARY_INV` for estimated light backgrounds (`>=127`) and `THRESH_BINARY` for dark backgrounds.
3. `polarity-aware-adaptive`: unblurred grayscale; `adaptiveThreshold(..., ADAPTIVE_THRESH_GAUSSIAN_C, same polarity, blockSize, 3)`.

`_candidate_quality()` computes foreground ratio, nonzero border ratio, and connected components. It favors occupancy near 18%, heavily penalizes occupancy above 72%, penalizes border foreground, and mildly penalizes component counts over 12. The maximum score wins.

- Dark background: polarity flips, and border-distance Otsu remains a competing polarity-independent candidate.
- Colored text: conversion to grayscale can erase colors close in luminance to the background. `colorInvariant: true` in persisted metadata overstates what is guaranteed.
- Transparency: `alpha=False`; RabbitHole does not inspect original alpha or blend mode.
- Antialiasing: Otsu/adaptive masks binarize it; resize later produces gray edges that are binarized again at 96.
- Border contamination: if glyph ink touches most borders, the median background estimate and quality score can be wrong.

## 17. Gaussian blur

The blur is always calculated as `cv2.GaussianBlur(gray, (3,3), 0)`. OpenCV derives sigma from kernel size because sigma is zero. It is persisted as the “Gaussian blur” inspection image and supplies only `polarity-aware-gaussian-otsu`.

It can damage punctuation, serifs, one-pixel terminals, or tightly spaced marks. The current mitigation is candidate competition: border-distance Otsu and adaptive threshold use the unblurred crop. There is no explicit “thin glyph” detector or before/after preservation threshold.

## 18. Morphological opening, erosion, and dilation

No runtime opening, erosion, or dilation is applied to the classifier mask. The source explicitly states that thin glyphs and punctuation are legitimate evidence. There is therefore no runtime kernel, iteration count, or preservation fallback to report.

Training augmentation occasionally applies one 2×2 erosion or dilation (`18%` chance, equally choosing erosion/dilation) to synthetic images. That changes training specimens only. It does not modify analyzed PDF pixels.

Legacy schema-4 database records mention `conservative open`; those records are not schema-6 behavior and are blocked by version filtering.

## 19. Tight crop

Tight bounds are the single rectangle around every nonzero pixel in the selected threshold mask:

```python
foreground = cv2.findNonZero(binary)
x, y, width, height = cv2.boundingRect(foreground)
tight = binary[y:y+height, x:x+width]
```

No contour filtering, minimum component area, component selection, or padding is applied. Multiple components—such as the dot and stem of `i`, counters, disconnected punctuation, noise, or neighboring ink—are retained in one union box.

- No ink: preprocessing fails and Raster is unavailable.
- One isolated pixel: accepted, enlarged, and classified; there is no minimum foreground count.
- Multiple components: all retained.
- Overlapping glyph: not disentangled.

## 20. 96×96 normalization

**Layer 1.1 revision:** The normalized 96×96 shape specimen and 64×64 model tensor remain. The old conclusion that relative size “disappears” is now mitigated by a separate Raster typographic vector containing bbox/font-size, crop/expected-font-pixel, ink/expected-font-pixel, and baseline-relative measurements. It remains valid that the image branch alone loses these clues.

The normalized evidence canvas is 96×96. Sixteen pixels are reserved in total, so the tight crop's longest dimension is fitted to 80 pixels:

```text
scale = min(80/inkWidth, 80/inkHeight)
targetWidth  = round(inkWidth*scale)
targetHeight = round(inkHeight*scale)
offsetX = floor((96-targetWidth)/2)
offsetY = floor((96-targetHeight)/2)
```

Aspect ratio is preserved; X and Y are never independently scaled. Centering uses the tight bbox, not center of mass. Downsampling uses `INTER_AREA`; enlargement uses `INTER_CUBIC`; the result is binarized at 96. The model adapter then uses `INTER_AREA` to resize 96×96 to its actual 64×64 input.

Consequences by shape:

- `I`: height becomes approximately 80; narrow width remains proportionally narrow, but absolute cap-height and font size disappear.
- `W`: width commonly becomes 80; height is reduced proportionally, preserving its wide shape.
- `S`: longest dimension becomes 80; curves are retained only at 96/64-pixel resolution, and normalization can erase uppercase/lowercase size differences.
- `.`: a tiny dot can be enlarged until its longest dimension is 80. This preserves its local aspect but destroys the fact that it was tiny relative to the line/font. This is a major punctuation/case-context limitation.

The 96×96 size is an implementation constant, not justified by an empirical ablation study in the repository.

## 21. Raster morphology features

**Layer 1.1 revision:** Schema 6 adds `typographicEvidence` beside morphology. Six Raster-relative measurements plus baseline fields can reach the fusion MLP; they are accompanied by a feature mask. Legacy contour/component/edge scalars remain inspection evidence and are not silently repurposed as identity labels.

`opencv_glyph_evidence.py::extract_raster_glyph_evidence()` derives morphology from the selected 96×96 binary mask. The persisted morphology object contains the raw crop and normalized dimensions, tight ink bounds, contour count, estimated counter count, connected-component count, aspect ratio, foreground percentage, edge percentage, threshold method/value, background estimate, and the selected preprocessing description. It also records a SHA-256-derived fingerprint beginning with `opencv96:`.

Contours are read with `RETR_CCOMP`, so the implementation can inspect parent/child relationships. Counter count is an estimate based on contour hierarchy, not semantic knowledge that a hole belongs to a particular letter. Connected components count disconnected foreground regions. Aspect ratio describes the tight ink rectangle rather than the original typographic em box. Foreground and edge percentages are normalized image statistics. None of these scalar features is passed as a separate feature vector to the production classifier; the CNN consumes the normalized mask itself. The features are evidence for inspection, debugging, and future analysis.

## 22. Computer vision role

OpenCV 5.0.0 is currently responsible for page cropping, grayscale preprocessing, blur, Otsu/adaptive thresholding, candidate scoring, tight bounds, connected components, contours, Canny edges, resizing, and normalized-mask production. It is not trained, and it does not by itself assign a character identity.

An older three-font visual-similarity mechanism remains as debug evidence. It renders Helvetica, Times-Roman, and Courier references and combines Dice overlap (0.52), IoU (0.23), and `matchShapes` (0.25). These rankings are exposed as legacy/debug candidates only. They do not select the production Raster Predicted Char. This distinction is observable in the audited real `E`: the debug bank ranked `F` slightly above `E`, while the CNN correctly returned `E`.

OpenCV therefore creates and describes visual evidence; `neural_glyph_recognizer.py` interprets that evidence. Claims that “OpenCV recognized the character” would be technically inaccurate for the current implementation.

## 23. Raster character classifier

**Layer 1.1 revision:** The current artifact is `rabbit_glyph_raster_v2.torchscript.pt`, model `rabbit-glyph-raster-fusion` v2. It fuses a CNN image encoder with a masked typographic MLP and has separate character and knownness heads. The v1 architecture/size below is retained only as the historical baseline.

**Historical schema-5 baseline:** the former production Raster recognizer loaded `models/rabbit_glyph_cnn_v1.torchscript.pt`, declared `glyph-neural-rabbit-cnn-v1-preprocess-v2`, and named the model `rabbit-glyph-cnn` version 1. The current schema-6 recognizer is described in the revision paragraph above.

The network in `glyph_neural_model.py` accepts one 64×64 grayscale channel. Four convolutional stages use 16, 32, 64, and 96 channels with batch normalization, GELU, and pooling. Adaptive pooling reduces the final feature map to 4×4; the classifier uses a 256-unit fully connected layer before 93 logits. The 96×96 stored mask is resized to 64×64 by the runtime.

Inference produces softmax probabilities after temperature scaling. The implementation stores the five highest candidates, the top-one/top-two margin, normalized entropy, and a status. The model has no language model, word context, line context, font name input, Given Char input, or Vector prediction input.

## 24. Training data

**Layer 1.1 revision:** The v2 trainer retains installed-font synthetic positives and adds explicit open-set/corruption negatives: non-Latin scripts, symbols, ligatures, blank, clipped, overlapping, noise, and border specimens. It exports separate Raster/Vector artifacts. It still does not use PDF Given or `/ToUnicode` labels, and it remains synthetic bootstrap training—not natural-PDF validation.

`train_glyph_classifier.py` synthesizes labeled glyph images from fonts discovered through `fc-list`. A font is admitted only if it covers at least 90% of the 93-character vocabulary. Discovery is capped at 60 font families and uses seed `731994`. Families—not individual rendered samples—are split to reduce direct family leakage: the audited metadata records 40 training families/74 font files, 9 validation families/13 files, and 11 test families/19 files.

The saved report records 13,764 training samples, 1,209 validation samples, and 1,767 synthetic test samples. Rendering uses a 150×150 work canvas with variable size (62–112), shift (±3), horizontal scale (0.88–1.12), vertical scale (0.90–1.10), rotation (±3.5°), occasional dark background (18%), blur (55%, radius 0.15–0.75), contrast (0.78–1.25), noise (45%, sigma 0.8–3.2), and occasional one-iteration 2×2 erosion/dilation (18%). Samples then enter the same proportional normalization family used at runtime.

The training corpus is synthetic installed-font rendering. It contains no audited real PDF crops, scans, damaged documents, colored/translucent text, or user-confirmed labels. The existence of `GlyphCharTrainingSample` does not mean those samples are consumed by this trainer; they currently are not.

## 25. Character vocabulary

**Layer 1.1 revision:** The 93 closed-set labels remain under vocabulary `latin-print-open-set-v2`, but the recognizer no longer forces every visible specimen into them. Unknown is an epistemic open-set status, not a fake Unicode replacement class. Multi-character and unsupported-sequence states are represented outside the single-character head.

The model vocabulary contains 93 single-character labels:

```text
A–Z
a–z
0–9
.,:;!?()[]{}+-=*/%$#@&_|\|'"`~<>
```

The vocabulary version is `latin-print-v1`. There is no explicit class for space, no-glyph, unknown, multi-character ligature, combining mark sequence, tab, newline, emoji, non-Latin script, or arbitrary Unicode. Absence is represented by evidence status rather than a classifier class. Any glyph outside the vocabulary can only be misclassified as one of these 93 labels or become unavailable/ambiguous through surrounding logic.

## 26. Model output

**Layer 1.1 revision:** Current output adds `closedSetTopCandidate`, `closedSetStatus`, `modelScore`, artifact/metadata hashes, typographic/open-set/calibration versions, and `openSetAssessment {status,score,energyScore,method,nearestKnownCandidates,reason}`. `predictedChar` is null for `OUT_OF_VOCABULARY` and `OPEN_SET_UNCERTAIN`. `confidence` remains null because v2 is not proven calibrated on real PDFs.

The neural result has this effective shape:

```json
{
  "status": "predicted | ambiguous | unpredictable | unavailable",
  "predictedChar": "E",
  "confidence": 0.919629,
  "candidates": [{"char":"E","probability":0.919629}],
  "top1Top2Margin": 0.908264,
  "normalizedEntropy": 0.12854,
  "modelName": "rabbit-glyph-cnn",
  "modelVersion": 1,
  "modelScore": 0.919629,
  "trainingDatasetVersion": "synthetic-installed-fonts-v1",
  "characterVocabularyVersion": "latin-print-v1",
  "preprocessingVersion": "opencv-proportional-polarity-v2",
  "calibrationVersion": "temperature-scaling-v1",
  "probabilitiesCalibrated": true,
  "predictionSource": "BASE_MODEL",
  "unavailableReason": null
}
```

`candidates` is capped at five and sorted by descending probability. `confidence` is the top-one temperature-scaled probability only when model metadata declares calibration. There is no current `predictedChars` plural property and no beam/string decoding.

## 27. Confidence

**Layer 1.1 revision:** V2 metadata declares `probabilitiesCalibrated=false`, calibration version `real-pdf-required-v2`. The UI says **Model score**. The historical v1 temperature/ECE discussion below must not be projected onto v2.

Confidence is not a probability that the persisted answer is true in the target PDF population. It is the temperature-scaled top-class softmax score from a model trained on synthetic fonts. The artifact stores temperature `1.0750000476837158`, calibration version `temperature-scaling-v1`, and preprocessing version `opencv-proportional-polarity-v2`.

The calibration evidence is weak: validation ECE worsened from 0.02307 to 0.03747 and test ECE worsened from 0.02912 to 0.04663 after scaling. Validation NLL improved slightly (0.66476 → 0.65735), while test NLL worsened (0.34956 → 0.36680). The system accurately reports that scaling is applied, but external reviewers should not treat the scalar as well calibrated across real PDFs.

## 28. Ambiguity

**Layer 1.1 revision:** Closed-set ambiguity remains separate from open-set knownness. Explicit knownness review boundaries exist in bootstrap metadata, but they are not validation-derived admission thresholds. Unknown and uncertain specimens cannot produce admitted machine Char under the current policy.

The configured thresholds are:

```text
minimum top-one probability: 0.56
minimum top-one/top-two margin: 0.14
maximum normalized entropy: 0.54
unpredictable probability threshold: 0.24
```

A low top score, narrow margin, or high entropy produces `ambiguous`; a top score below 0.24 produces `unpredictable`. Model loading/inference failure produces `unavailable`. These are manually configured operating thresholds, not a rejection model trained on out-of-vocabulary glyphs. As a result, an unsupported glyph can still receive a confident in-vocabulary answer.

## 29. Candidate list

**Layer 1.1 revision:** Candidate lists now explicitly mean closed-set nearest candidates. They remain inspectable even when open set rejects the specimen; the UI displays that distinction and never presents a rejected top candidate as final Raster/Vector Char.

Five closed-set model candidates are retained for each channel. Raster debug candidates from the old OpenCV reference bank are stored separately and must not be mixed with fusion-model scores. Vector recognition exposes its own candidate list from its independently versioned artifact. The API and UI preserve the source boundary, so reviewers can see that “Raster candidate E” and “Vector candidate E” came from different masks, typographic evidence, model artifacts, and runtime channels.

No candidate combines Given, Vector, Raster, or Human evidence into a consensus score. Comparison is symbolic and status-based, not probabilistic fusion.

## 30. The “S” failure

**Layer 1.1 revision:** The historical examples below motivated the typographic-relative architecture. V2 now receives cap/x-height, em-space, bbox/font-size, and baseline evidence where available. This is an architectural correction, not evidence that S/s is solved: no adjudicated v2 real-PDF S/s metric exists.

The repository/database contains a historical schema-4 failure for page 7 glyph 3 of the large cached PDF: Given Char `S` was assigned an old heuristic prediction of apostrophe with confidence 0.917008 and visual score 0.761301. That record used recognizer `opencv-adaptive-v2`; it is neither schema-5 nor schema-6 output and is filtered from current job lookup.

A historical schema-5 run on the same occurrence (`MyriadPro-Cond`, glyph 52, bbox approximately 82.163×98.924 to 86.315×110.424) yielded Raster `S` at 0.613266, then `s` at 0.124799 and `5` at 0.036239; margin 0.488467, normalized entropy 0.430734, status `predicted`, comparison `MATCH`. The legacy debug bank ranked `&` (0.456054) just above `S` (0.449734), demonstrating why the debug matcher was not authoritative. This is not a v2 result.

The historical v1 model nevertheless had an S/s weakness. On page 7 glyph 672, Raster ranked lowercase `s` at 0.55908 and uppercase `S` at 0.26248, narrowly failing the old 0.56 threshold while Vector predicted `S`. This is motivation for v2, not a v2 result.

## 31. Regression test for S

**Layer 1.1 revision:** The schema-6 Python suite retains the S path and now also verifies actual typographic-feature flow into the fusion model. It does not yet provide a statistically adequate real-PDF S/s/5/$ regression corpus.

`test_glyph_char_analysis.py` includes an uppercase-S regression across Helvetica, Times-Roman, and Courier. It asserts the current neural path can retain/recognize an uppercase S across those controlled fonts. The test passes.

This is useful but not sufficient. It tests three generated/reference fonts, not MyriadPro-Cond, embedded CFF extraction, real page compositing, tiny sizes, all rotations, or the broad S/s/5 family. The synthetic test report records S precision 81.3% and recall 68.4% on only 19 test specimens. A production regression should include the two real occurrences above as immutable fixtures and test both correct acceptance and correct ambiguity.

## 32. Vector versus Raster independence

**Layer 1.1 revision:** Raster and Vector now have separate artifacts, names, metadata, runtime channels, hashes, and caches. Their initial architecture/training remains related, so software separability has improved while statistical independence is still not established.

The evidence inputs are independently created:

- Vector begins with embedded font bytes, glyph ID, and outline commands.
- Raster begins with rendered page pixels cropped by the occurrence bbox.

Neither path reads the other path’s prediction. The test suite explicitly checks separation and vector/raster disagreement. A failure in one path does not suppress the other.

They are software-separable but not proven statistically independent. The channels use different v2 artifact files, identities, hashes, caches, and inputs, yet share the same fusion architecture, vocabulary, and related synthetic bootstrap procedure. They may therefore retain correlated model bias and also share upstream glyph ID/bbox extraction. “Independent evidence source and artifact” is accurate; “empirically independent error process” is not yet established.

## 33. Given Char independence

Given Char is never supplied to vector/raster preprocessing or neural inference. It is added only after predictions for comparison. A passing test asserts Raster can be generated without using Given Char. Human confirmation also cannot overwrite the model prediction.

There is still shared upstream dependency: PyMuPDF supplies both Given and glyph geometry/font metadata. Independence means no label leakage into recognition, not total subsystem isolation.

## 34. Human confirmation

**Layer 1.1 revision:** Hydrated Human evidence now retains `confirmedBy`, timestamp, `scope=font-definition`, strong definition identity, and occurrence identity. It causes `HUMAN_ASSERTED` admission without rewriting Given, Vector, or Raster. Same-name definition leakage is mitigated by hash+xref+GID identity. Confirmation-memory governance and training promotion remain deliberate future work.

The frontend can persist a human-confirmed character through `POST /jobs/:jobId/training-samples`. MongoDB stores `userId`, document/job/page/glyph identity, definition reference/fingerprint, Given/predicted values, confirmed character, evidence snapshot, model versions, and timestamps in `GlyphCharTrainingSample`.

On result hydration, human confirmations are attached as an additional evidence field. They do not overwrite Given, Vector, Raster, or comparison. Schema 6 propagates definition-scoped confirmation through strong program-hash+xref+GID identity; fallback scope remains explicitly weak. Confirmed samples are not fed automatically into training or fine-tuning.

## 35. Training and retraining

Training is an offline command-line process, not an API job. `train_glyph_classifier.py` builds the synthetic dataset and TorchScript model; `benchmark_glyph_classifier.py` renders a real-PDF-style benchmark; `evaluate_exported_glyph_classifier.py` validates the exported artifact. AdamW uses learning rate `1.5e-3`, weight decay `1e-4`, cosine scheduling for six epochs, and label smoothing 0.04.

There is no model registry service, staged deployment, automatic rollback, online learning, user-specific model, incremental retraining, or training-sample review/quality gate. Replacing the model requires producing compatible metadata/artifact, changing/versioning constants as appropriate, deploying the Python service, and starting new schema/version jobs. Existing persisted evidence is deliberately version-filtered and is not silently reinterpreted.

## 36. No label leakage

The inspected code enforces the following data flow: Given Char is passed to `compare_glyph_character_evidence()` only after Raster and Vector analysis; it is not accepted by the classifier runtime. Human labels live in a separate Mongo collection and are joined during result retrieval, not Python inference. The production classifier accepts only a normalized image tensor.

Tests cover that Given is comparison-only, Raster remains independent, and Human cannot override predictions. The residual leakage risk is procedural rather than a current code path: a future trainer could ingest `GlyphCharTrainingSample` without family/document isolation, or cached evidence could be mismatched if version keys are weakened. No such ingestion currently exists.

## 37. Comparison engine

`glyph_char_analysis.py::compare_glyph_character_evidence()` compares evidence without choosing a master truth. Its result distinguishes matching, disagreement, ambiguity, no Given, no visible glyph, unpredictable/unresolved, and source-availability conditions. The UI’s `comparisonState.js` maps backend states to display labels/symbols.

The core policy is:

- Given versus a usable visual prediction can be `MATCH` or `DISAGREEMENT`.
- Ambiguous/unpredictable predictions are not promoted to a definitive disagreement.
- Missing Given remains `NO_GIVEN`, not a classifier failure.
- Vector and Raster disagreement is retained rather than fused away.
- Human is displayed as a separate confirmation.

The comparison is exact character equality. It does not normalize Unicode canonical equivalents, case, confusables, ligatures, whitespace classes, or OCR-friendly alternatives.

## 38. Spaces

Space is not in the 93-class model. PyMuPDF can emit an instance whose Given value is a space, but an ordinary space has no visible ink. Raster preprocessing then returns no foreground and classifies the evidence condition as `NO_VISIBLE_GLYPH`; Vector may be unavailable or may expose a zero-contour/advance-width definition depending on the font.

The selected-glyph UI must therefore show the actual selected instance and state rather than remaining fixed on space. Current selection derives from per-glyph IDs and was corrected to avoid that stale-space behavior. Space identity is still known only through Given/font encoding evidence; the visual classifier does not predict it.

## 39. Ligatures

**Layer 1.1 revision:** Schema 6 stops representing every occurrence as an ordinary single Char. Given sequences longer than one code point receive `MULTI_CHAR_GLYPH`; open-set/admission remains unavailable or blocked for that sequence. Full visual sequence recognition is intentionally not implemented.

The classifier emits one vocabulary character per glyph. A PDF font glyph may encode `fi`, `ff`, Arabic contextual forms, a decomposed sequence, or a private-use mapping. Given may contain multiple Unicode characters after PyMuPDF decoding, while the neural model cannot emit a sequence. Such comparisons are structurally incomparable and can appear as disagreement or unsupported evidence.

The implementation does not split ligature outlines, run sequence recognition, retain original CMap source bytes, or model one-glyph-to-many-character alignment. This is a fundamental Layer 1 scope gap, not a threshold bug.

## 40. Cache architecture

**Layer 1.1 revision:** Raster inference cache identity now includes channel, mask bytes, typographic values, typographic availability mask, and model artifact identity. Vector identity/cache includes program hash, xref, GID, model, and typographic versions. Process-lifetime limitations described below remain.

The current caches and bounds are:

| Cache/store | Location | Key/capacity | Lifetime |
|---|---|---|---|
| neural predictions | Python `neural_glyph_recognizer` module | normalized-mask SHA-256; LRU 8,192 | one Python process |
| raster morphology | `opencv_glyph_evidence.py` | crop/evidence identity; LRU 8,192 | one Python process |
| vector analyses | `vector_glyph_evidence.py` | font/glyph/model identity; LRU 4,096 | one Python process |
| parsed fonts | vector module | font identity; 64 | one Python process |
| font bytes | vector module | source/xref identity; 32 | one Python process |
| reference banks | debug recognizer | one constructed bank | one Python process |
| page renderer | frontend hook | approximately 2 rendered pages | component session |
| browser local predictions | frontend hook | map, no explicit item cap | component session |
| evidence pages | frontend | source/page map, no explicit map cap | component session |
| hydrated glyphs | frontend | oldest-page pruning at 30,000 glyphs | component session |
| document resolution | backend helper | 32 entries | Express process |
| results | MongoDB | versioned jobs/pages/stages/samples | durable |
| PDF files | Python cache directory | hash/path based; no repository eviction policy | disk |

A major practical caveat is that each Express extraction call starts a multiprocessing Python child. The process-local LRU caches and loaded Torch runtime therefore die after that page call. They benefit repeated glyphs within one extraction but not normally subsequent pages. The durable Mongo cache is the only cross-process analysis cache.

## 41. Cache invalidation

**Layer 1.1 revision:** Durable lookup now uses schema 6 and `glyph-identity-fusion-v2`; jobs pin all model/pipeline version fields and model/metadata hashes. The historical weak definition-key and absent-artifact-checksum findings are corrected on the authoritative schema-6 path. Disk-cache eviction and startup integrity enforcement remain open.

Durable jobs are selected by user, document, analysis schema version, and recognizer version; the job model has a unique compound index over these versioned identifiers. A model/preprocessing/schema change must change the associated version constant to prevent stale evidence reuse. Python mask fingerprints additionally identify normalized raster content.

Weak points:

- `definitionRef` based on font name plus glyph ID does not include the embedded font file hash and can collide.
- The job stores a document hash, but invalidation depends on all callers resolving and updating it correctly.
- Browser caches are component-local and are not centrally invalidated.
- Old schema records remain in Mongo but are hidden by current-version lookups.
- There is no disk-cache eviction or model-artifact checksum verification at service startup.

## 42. Background job architecture

`GlyphCharAnalysisWorker.js` runs jobs in the Express process. A start request creates/resumes a Mongo job and schedules an async worker. The worker iterates pages sequentially. For all-document scope it saves a batch every 10 pages; for per-page scope it processes the requested page. Each page is delegated to the Python `/extract-page` endpoint via `pdfStructureService.js`.

`activeJobs` is an in-memory process map. Multiple jobs may run concurrently without a global worker-pool limit. A server restart scans queued/processing jobs and schedules them again; completed page chunks let processing resume, although an unsaved current batch of up to nine pages is reprocessed. There is no external queue, lease owner, distributed lock, priority, rate limiter, or multi-process-safe scheduler.

Cancellation updates Mongo and is checked between extraction steps/pages. It does not currently invoke Python `/cancel-extract`, so it is not immediate during an expensive page. Heartbeat timestamps are written around work/save boundaries, not continuously during a long extraction. `attempts` increments on worker slices, including ordinary ten-page continuations, so it is not a pure retry count.

## 43. Database models

**Layer 1.1 revision:** Job persistence now includes Raster/Vector model identities, vocabulary, open-set, preprocessing, typographic, calibration, validation, admission versions, and artifact hashes. Page glyphs use a structured sub-schema with a strict admission decision while retaining flexible evidence internals. New `Layer1ValidationSample` and `Layer1ValidationProfile` models support corpus partitions, governance, independent reviews, frozen metrics, hashes, and explicit approval. Multi-document transactions are still absent.

`GlyphCharAnalysisJob` stores ownership and source identity; schema/recognizer versions; status (`queued`, `processing`, `completed`, `partial`, `failed`, `cancelled`); scope and requested/current page; page counts/progress; aggregate evidence counts; ToUnicode detection; attempts/resume count; error; heartbeat; and start/finish timestamps.

`GlyphCharAnalysisPage` stores page number, dimensions/rotation, chunk index/count, `complete`, a mixed array of glyph instances, and vector definitions (normally on chunk zero). Chunks contain at most 750 glyphs. `GlyphCharVisualStage` stores large raster stage payloads separately so ordinary result hydration is lighter. `GlyphCharTrainingSample` stores user confirmations separately from model output.

Persistence is not transactional. The worker deletes old page/stage records, inserts stages, inserts incomplete chunks, and then marks chunks complete. A crash can leave partial artifacts; reads must honor `complete`. Mongo `Mixed` fields provide schema flexibility but reduce database-level validation. Training samples are intentionally not deleted when analysis results are deleted.

## 44. API

**Layer 1.1 revision:** Add current validation routes: `GET /validation/profile`, `GET/POST /validation/samples`, and `POST /validation/samples/:sampleId/reviews`. Result hydration returns/recomputes `admissionDecision`; no API exposes raw prediction as a canonical Layer 2 `{char}` contract.

Express mounts `GlyphCharAnalysisAPI.js` at `/api/glyph-char-analysis`; all routes require authenticated user ownership.

```text
POST   /documents/:documentId/start
GET    /documents/:documentId
GET    /jobs/:jobId/results?afterPage=&limitPages=&pageNumber=
GET    /jobs/:jobId/visual-stage
POST   /jobs/:jobId/training-samples
POST   /jobs/:jobId/cancel
DELETE /jobs/:jobId/results
```

`limitPages` defaults to 2 and is capped at 4. Result requests can page forward or request one page. Delete first cancels/waits for active work, then removes pages, visual stages, and the job; repeating delete is designed to be safe. Historical 404s on cancel/delete were caused by running an Express process without the current route set and require restarting the port-4000 server; the routes exist in the inspected tree.

Python exposes `/health`, `/ensure-document`, `/extract-page`, and `/cancel-extract` on the separate FastAPI service (normally `127.0.0.1:8002`). The Express API is the public/authenticated boundary.

## 45. Frontend hydration

`useGlyphCharAnalysis.js` fetches the current versioned job even before the user starts a new analysis, allowing saved results to display. While active, it polls approximately every 1.4 seconds and hydrates result windows of two pages. All-document and per-page scopes maintain distinct labels and progress presentation; per-page start sends page scope and must not trigger document analysis.

The frontend caps hydrated glyph instances at 30,000 and prunes older pages while preserving the initial/selected page where possible. Visual-stage images are lazy-loaded for inspection rather than included in every page result. A limitation is that an inactive saved-results load tends to fetch the current page rather than eagerly filling the document; pruned pages can also require explicit rehydration logic. Backend progress is page/batch granular, so document progress may jump every ten persisted pages.

## 46. Right aside UI

**Layer 1.1 revision:** The aside additionally shows closed-set candidate versus open-set assessment, Measurement Validity, model/profile/approval identities, typographic-relative details, admission state/admitted Char/reason codes, and the wording **Evidence agreement**. Agreement is no longer styled or labelled as proof of correctness.

The Layer 1 aside (`GlyphCharAside.jsx`) exposes:

- scope tabs for All Document and Per Page;
- explicit start labels, cancel, delete-all-results, and saved/job status;
- document progress only for document scope and page-oriented status for per-page scope;
- summary counts and filters for all, match, disagreement, ambiguous, no Given, and unpredictable;
- selectable glyph result rows;
- separate Given, Vector, Raster, Human, and Comparison cards;
- vector outline/mask preview and vector morphology/recognition details;
- raster raw, grayscale, blur, threshold, tight-crop, normalized-mask, contour, and edge inspection stages where available;
- CNN candidates plus legacy debug candidates, clearly separated;
- a `/ToUnicode` detected tag at document/page level;
- a human-confirmation control.

The filter list does not offer every backend state (for example, no dedicated no-visible filter). “Progress” during one page’s internals is partly a UI waiting heuristic because the backend reports page completion, not per-glyph completion.

## 47. Glyph selection

`GlyphSelectionOverlay.jsx` maps persisted page-space bboxes over the PDF page and sends a glyph instance ID to the analysis hook. Selection resolves the matching hydrated instance and drives the aside inspector. The overlay follows page scale and rotation transforms rather than estimating positions from text length.

Selection is not durably persisted. Navigation, result replacement, or hydration pruning can clear it; a selected glyph on a page no longer in the 30,000-item window may require re-fetching. The evidence record remains in Mongo, but UI selection continuity is best-effort session state.

## 48. Memory safeguards

Implemented safeguards include a 12-million-pixel page-render budget, trace cap of 50,000 characters, content-operator cap of 2,000, operand/raw text truncation (1,200/6,000), Python LRU bounds, 750-glyph Mongo chunks, 10-page save batches, result pagination capped at four pages, approximately two rendered browser pages, and 30,000 hydrated glyphs.

Gaps include unlimited concurrent jobs, no persistent queue backpressure, no PDF disk-cache eviction, Mongo `Mixed` payloads, browser maps without universal caps, full-page rendering before per-glyph crops, and child-process duplication of model/runtime memory. The prior Node heap exhaustion is consistent with large unbounded payload/hydration behavior; the present limits reduce but do not prove elimination under many simultaneous large jobs.

## 49. Performance profile

**Layer 1.1 revision:** Schema-6 page output instruments rendering, Raster preprocessing, Vector extraction/inference, Raster inference/open-set, total page, and DB persistence. A controlled 18-glyph same-process smoke run measured cold 5.796 s, warm 0.246 s, and peak RSS 656,740 KiB. Historical large-page numbers below remain useful schema-5 baseline observations but are not v2 capacity statistics.

On the audited environment, a 1,372-glyph real page completed forensic extraction in about 0.133 seconds and full Layer 1 analysis in about 20.970 seconds. A page from a 337 MB PDF containing 740 glyphs completed in about 14.909 seconds. These are local observations, not controlled production benchmarks.

A 62-mask classifier probe took 0.181673 seconds cold (about 2.93 ms/mask including model load) and 0.001925 seconds warm (about 0.031 ms/mask). This demonstrates effective within-process batching/cache behavior but excludes page rendering, preprocessing, vector parsing, debug similarity, IPC, and Mongo persistence. Because the current backend launches a child per page, warm model benefits generally do not cross page boundaries.

The dominant costs are expected to be full-page rendering, per-glyph OpenCV processing/debug references, font extraction/parsing, model startup, IPC serialization, and Mongo stage writes. The repository has no production percentile telemetry, memory watermark logging, queue-duration metric, or page complexity budget beyond pixel/glyph/operator caps.

## 50. Failure isolation

Raster and Vector extraction are individually guarded: unavailable font outlines, OpenCV failure, empty foreground, and model failure produce evidence statuses/reasons while preserving other morphology or evidence channels. Tests verify OpenCV and neural failure do not erase all page evidence.

At the job level, most unhandled per-page/Python/DB failures mark the job failed rather than recording a failed page and continuing. Saving is nontransactional. Cancellation waits for the current Python extraction. A killed Express process can resume from completed Mongo chunks, but loses the in-memory active map and can redo the unsaved batch. A killed Python child loses only that invocation’s caches/work. There is no dead-letter queue, exponential retry policy, circuit breaker, or automatic quarantine for pathological pages.

## 51. Test suite

**Layer 1.1 revision:** The current Python suite has 10 passing tests, adding strong font-definition collision resistance and proof that typographic measurements change fusion-model input/output. Admission tests cover unapproved blocking, approved-policy eligibility, Human assertion, and frontend fail-closed access. Direct Node assertions passed; installed Node package runners were unavailable for a complete current rerun.

### Python tests

The following eight were the original schema-5 baseline tests; schema 6 retains them and adds two more, for a current total of 10 passing Python tests:

| Test | Invariant |
|---|---|
| `test_embedded_font_produces_separate_vector_and_raster_evidence` | embedded-font Vector and rendered Raster evidence remain separately present |
| `test_given_char_changes_only_the_comparison` | changing Given cannot change visual inference |
| `test_vector_raster_disagreement_is_explicit` | disagreement is preserved |
| `test_raster_prediction_is_independent_of_given_char` | Raster does not consume Given |
| `test_human_label_cannot_override_base_model_inference` | Human remains a separate layer |
| `test_neural_failure_preserves_opencv_morphology` | classifier failure does not erase morphology |
| `test_uppercase_s_regression_across_held_out_fonts` | uppercase S survives three controlled font cases |
| `test_opencv_failure_is_nonfatal_for_the_page` | Raster CV failure is represented rather than crashing page analysis |

The run emitted a Torch warning that `torch.jit.load` is deprecated in favor of `torch.export`; it did not fail the tests.

### Backend integration tests

`back/test/glyphCharAnalysis.integration.test.js` defines two Mongo-backed Mocha tests:

- `hydrates page checkpoints in deterministic page/chunk order`: exercises authenticated lookup, chunk ordering, visual-stage retrieval, human training sample attachment, cancellation, deletion, and idempotent deletion.
- `does not expose a persisted job to another user`: checks ownership isolation.

They passed earlier in this audit session (2/2, approximately four seconds). A final reproducibility rerun could not launch because the current `back/node_modules` does not contain the declared Mocha binary (`npm`/`npx` exit 127). This is a dependency-install/tooling defect, not a newly observed assertion failure, but it means a clean current backend test command is not reliable.

### Frontend tests

Twelve tests in four files passed in 602 ms through direct Vitest invocation:

- `glyphCharComparison.test.js` (8): Given independence, Vector/Raster disagreement, match, disagreement, no Given, no-visible source evidence, ambiguity, and prediction independence.
- `glyphPredictionCache.test.js` (1): hundreds of instances reuse one stable definition analysis.
- `GlyphSelectionOverlay.test.js` (1): the same document glyph remains selected through zoom.
- `glyphForensics.test.js` (2): identical masks score deterministically and same-font malformation is separated from fallback-font uncertainty.

The package script previously failed to locate `vitest`; direct `node node_modules/vitest/vitest.mjs` works. This is another test-command packaging defect.

### Missing tests

There are no automated tests for worker restart during an unsaved ten-page batch, cancellation during a running Python page, multi-worker leases, CFF/Type1/Type3/CID matrices, ligatures, rotations end-to-end, dark/colored/translucent text, huge-document memory ceilings, model artifact corruption, API start/resume routing, or real-PDF S fixtures. Existing tests establish important invariants but do not establish production recognition reliability.

## 52. Validation metrics

**Layer 1.1 revision:** Everything in the historical metric tables below belongs to schema-5/v1 generated benchmarks. Current v2 real-document metrics are all unavailable because the manually adjudicated corpus has 0 documents and 0 resolved glyphs. The machine-readable v2 profile therefore has `approvedForDownstream=false`, null top-1/top-3/selective/open-set/calibration values, and no active selective-risk thresholds.

The checked-in model report contains the following measured results:

| Evaluation | Samples | Top-1 | Top-3 | Ambiguous | Unpredictable |
|---|---:|---:|---:|---:|---:|
| synthetic validation | 1,209 | 89.578% | 92.308% | 5.376% | 1.902% |
| synthetic held-out-family test | 1,767 | 91.454% | 99.151% | 7.074% | 0.509% |
| rendered real-PDF benchmark | 21,196 | 82.369% | 95.688% | 16.829% | 4.935% |

The historical generated-PDF benchmark covered 19 held-out font files, sizes 6, 8, 10, 12, 18, and 36 points, and render scales 2 and 4. It was not a manually adjudicated sample of naturally occurring production PDFs and is not evidence for v2. Current v2 real-document performance is unknown.

Calibration measurements:

| Split | ECE unscaled → scaled | NLL unscaled → scaled |
|---|---|---|
| validation | 0.02307 → 0.03747 | 0.66476 → 0.65735 |
| test | 0.02912 → 0.04663 | 0.34956 → 0.36680 |

Temperature scaling therefore improves only validation NLL and worsens both ECE values and test NLL. Representative weak synthetic-test classes include `S` (precision 81.3%, recall 68.4%, support 19), `V` (80.0%, 63.2%, 19), and `O` (77.8%, 73.7%, 19). The full 93×93 confusion matrix and all per-character metrics are stored in `back/pdf-structure/models/rabbit_glyph_cnn_v1.report.json` rather than reproduced as a 93-row appendix here.

## 53. Known character confusions

**Layer 1.1 revision:** The pairs below are historical v1 evidence and remain registered as known-risk families, not measured v2 outcomes. V2 must remeasure S/s/5/$, I/l/1/|, O/o/0, V/v, W/w, C/c, X/x, and Z/z on frozen adjudicated natural PDFs.

The real-PDF benchmark’s highest observed wrong top-one pairs are:

| Given → predicted | Count |
|---|---:|
| `V → v` | 183 |
| `W → w` | 169 |
| `O → o` | 157 |
| `S → s` | 156 |
| `C → c` | 156 |
| `X → x` | 156 |
| `Z → z` | 153 |
| `~ → -` | 71 |
| `U → u` | 70 |
| `/ → no accepted prediction` | 55 |
| `l → no accepted prediction` | 52 |
| `0 → o` | 52 |
| `| → l` | 47 |

These support broad uppercase/lowercase confusion and `0/o`, `|/l` confusion. The repository does not provide comparable evidence that `B/8`, `Z/2`, or `G/6` are leading current pairs, so this report does not label them known failures. S is particularly unstable: across 228 real benchmark conditions only 70 were accepted as top-one `S`.

## 54. Known limitations

**Layer 1.1 revision:** Several historical items below are corrected: raw CFF/Type1/CID adapters now exist; strong font identity replaces `fontName:glyphId`; typographic evidence survives normalization; explicit open-set rejection exists; models are separable; multi-character Given mappings are represented; and admission blocks raw machine output. Current major limitations are instead zero real-PDF validation, synthetic bootstrap weights, unmeasured calibration/selective risk/font coverage, incomplete Type3, incomplete parser fixtures, unavailable raw encoded glyph bytes, child-process runtime cost, and incomplete operational test execution.

The bullets immediately below are retained as the schema-5 limitation baseline. They are not the current Layer 1.1 limitation list and must be read together with the revision above and the current-state assessment in section 60.

- **PDF extraction:** PyMuPDF-decoded text loses the exact mapping path; source code/name/transform fields are incomplete; operator capture is capped/truncated; `/ToUnicode` is detected but not parsed or associated per glyph.
- **Fonts:** raw embedded CFF/Type1 frequently fails `fontTools` parsing (`bad sfntVersion`); Type3 is unsupported; CID/OpenType support is conditional; font-name matching and `fontName:glyphId` identity can collide.
- **Vector:** sampled polylines approximate curves; command-level outlines are not persisted; contour winding/counter inference is heuristic; failed extraction removes an important evidence channel.
- **Raster:** full-page grayscale rendering loses color/alpha semantics; crop boxes can include neighbors or clip antialiasing; no padding/component selection; tiny punctuation is enlarged until relative-size evidence disappears.
- **Classifier:** only 93 classes; synthetic training; 82.37% benchmark top-one; poor calibration; shared CNN correlates Vector and Raster errors; rejection does not guarantee out-of-vocabulary detection.
- **Unicode:** no arbitrary Unicode, canonical-equivalence handling, combining sequences, emoji, bidi/script-specific logic, or original encoded code retention.
- **Ligatures:** one glyph is forced toward one character; there is no sequence output or alignment model.
- **Geometry:** bboxes depend on `get_texttrace`; transforms are not fully persisted; overlapping/clipped/vertical glyphs and page boxes need broader validation. One audited occurrence had a bbox beyond nominal page height.
- **Performance:** per-page child startup defeats cross-page Python caches; full-page rendering and per-glyph work are expensive; no global job concurrency limit or disk eviction.
- **Validation:** benchmark labels are generated, real production PDFs are not manually adjudicated, per-font/script/document confidence intervals are absent, and S regression coverage is narrow.
- **UI:** hydration is windowed/pruned, progress is page-level and partly heuristic, not every status has a filter, selection is not durable, and large evidence payloads remain a memory risk.

## 55. Architectural invariants

**Layer 1.1 revision:** Add mandatory invariant 13: Layer 2 may consume only `Layer1AdmissionDecision`, never raw `prediction.predictedChar`. Add invariant 14: absent an explicitly approved validation profile, all machine output is `OBSERVE_ONLY`; only explicit Human evidence may be `HUMAN_ASSERTED`.

Future Layer 1 changes must preserve these rules, all of which are represented in current code/tests:

1. Given Char is evidence from PDF decoding, not truth.
2. Raster and Vector predictors must not consume Given Char.
3. Human confirmation must not rewrite original or model evidence.
4. Vector and Raster source evidence remains separate.
5. Vector/Raster/Given disagreement is persisted, not voted away.
6. `unavailable`, `ambiguous`, `unpredictable`, `NO_VISIBLE_GLYPH`, and `NO_GIVEN` are valid results.
7. No word, sentence, language, semantic, or patient context belongs in Layer 1 inference.
8. No automatic correction, majority vote, or “best answer” may erase source records.
9. Original PDF evidence and provenance are immutable append-only inputs from Layer 1’s perspective.
10. Model, preprocessing, vocabulary, calibration, and schema versions must participate in cache/persistence identity.
11. Higher layers may interpret Layer 1 but must remain downstream and must not back-propagate labels invisibly.
12. Every accepted character must retain its evidence channel, candidates, uncertainty, and failure reason where relevant.

## 56. Current Layer 1 output contract

**Layer 1.1 revision:** The JSON example below is a schema-5 historical specimen. The current envelope additionally contains all version/hash fields at job/page level and, per glyph, Given provenance/quality/sequence status, separate Vector/Raster typographic and open-set evidence, measurement quality, validation provenance, and `admissionDecision {state,admittedChar,reasonCodes,policyVersion,validationProfileVersion,evidenceSnapshot,modelVersions}`.

The following is a realistic, abbreviated instance using actual current property names. Large morphology objects and candidate tails are shortened; omitted raster `stages` are stored in `GlyphCharVisualStage`, not inline in `GlyphCharAnalysisPage`.

```json
{
  "id": "p1:g0",
  "pageNumber": 1,
  "instanceIndex": 0,
  "traceIndex": 0,
  "fontName": "MyriadPro-Light",
  "fontRef": "MyriadPro-Light",
  "fontSize": 10.0,
  "glyphId": 38,
  "sourceGlyphCode": null,
  "bbox": {"x":63.024,"y":191.6337,"width":4.66,"height":10.0},
  "transform": null,
  "geometryConfidence": "exact",
  "geometryMethod": "pymupdf-texttrace-glyph-bbox",
  "visible": true,
  "visualFingerprint": "opencv96:c8ccb...",
  "given": {
    "value": "E",
    "values": ["E"],
    "source": "pymupdfTextTrace",
    "rawCode": null
  },
  "prediction": {
    "status": "predicted",
    "predictedChar": "E",
    "confidence": 0.919629,
    "candidates": [
      {"char":"E","probability":0.919629},
      {"char":"F","probability":0.011365}
    ],
    "top1Top2Margin": 0.908264,
    "normalizedEntropy": 0.12854,
    "modelVersion": 1,
    "preprocessingVersion": "opencv-proportional-polarity-v2"
  },
  "comparison": "MATCH",
  "definitionCacheKey": "MyriadPro-Light:38",
  "resolvedCacheKey": "raster:1:opencv-proportional-polarity-v2:opencv96:c8ccb...",
  "analysisStatus": "studied",
  "visualEvidence": {
    "vector": {
      "available": false,
      "status": "unavailable",
      "definitionRef": "MyriadPro-Light:38",
      "cacheKey": null,
      "unavailableReason": "Embedded font outline could not be parsed: bad sfntVersion"
    },
    "raster": {
      "available": true,
      "status": "available",
      "fingerprint": "opencv96:c8ccb...",
      "method": "pymupdf-high-resolution-page-raster-exact-glyph-bbox",
      "renderScale": 4.0,
      "normalization": "opencv-tight-proportional-center-96",
      "preprocessing": {"thresholdMethod":"polarity-aware-gaussian-otsu"},
      "morphology": {
        "contourCount": 1,
        "aspectRatio": 0.518519,
        "foregroundPercentage": 0.141059,
        "rawWidth": 19,
        "rawHeight": 41
      },
      "recognition": {"status":"predicted","predictedChar":"E","confidence":0.919629},
      "instanceCacheKey": "raster:1:opencv-proportional-polarity-v2:opencv96:c8ccb..."
    }
  },
  "evidenceComparison": {
    "state": "MATCH",
    "givenChar": "E",
    "vectorPredictedChar": null,
    "rasterPredictedChar": "E"
  }
}
```

When one exists, the API joins a sibling `humanConfirmation` object with `confirmedChar`, `fingerprint`, `source`, and `updatedAt`. Frontend hydration prefixes `id` with the document ID, preserves the server value as `serverGlyphId`, and merges the separately persisted vector definition into `visualEvidence.vector`. Therefore Python output, Mongo chunk, API output, and browser object are related but not byte-identical contracts.

## 57. One complete real example

The original audit executed schema-5 analysis on page 1 of cached PDF SHA/path key `49bfc…` (page 612.048×783.048 points). The page yielded 1,372 glyph instances and 135 page-local definition entries. This example is retained as historical evidence and has not been regenerated as an adjudicated schema-6 fixture.

For `p1:g0`:

1. **Extraction:** `get_texttrace()` returned Unicode `E`, glyph ID 38, font `MyriadPro-Light`, font size about 10, origin from the trace character, and bbox x=63.024, y=191.6337, width≈4.66, height≈10. Raw source code and transform were unavailable (`null`).
2. **Geometry:** the bbox was accepted as exact PyMuPDF glyph geometry and converted into a grayscale pixmap crop at render scale 4. No equal-width span division occurred.
3. **Vector attempt:** the page font resource was located, but `fontTools.TTFont` could not parse the raw embedded CFF program (`bad sfntVersion`). Vector was persisted as unavailable under definition reference `MyriadPro-Light:38`; no outline, normalized vector mask, vector features, or Vector Predicted Char was fabricated.
4. **Raster source:** the crop measured 19×41 pixels. OpenCV produced competing threshold masks and chose polarity-aware Gaussian Otsu at threshold 182. Tight ink and proportional 96×96 normalization produced fingerprint `opencv96:c8ccb…`.
5. **Raster morphology:** contour count 1, tight aspect ratio 0.518519, foreground percentage 0.141059. The full raw/grayscale/blur/threshold/tight/normalized/contour/edge stages were separated into the visual-stage collection.
6. **Recognition:** the CNN returned `E` 0.919629, `F` 0.011365 second, margin 0.908264, entropy 0.12854, status predicted. The legacy debug matcher ranked `F` 0.522807 and `E` 0.516707, but did not control the answer.
7. **Comparison:** Given `E` and Raster `E` produced `MATCH`; the evidence state was effectively Raster-only because Vector was unavailable. No Human confirmation was attached.
8. **Persistence/UI:** the glyph was written in a 750-item page chunk; stages were keyed by job/page/glyph/fingerprint. The API later joins its chunk, vector-definition reference, optional confirmation, and lazy stage endpoint. Browser hydration prefixes the ID with document ID and renders the bbox overlay and separate Given/Vector/Raster/Comparison cards.

This example is a successful character decision but also exposes the main font limitation: the implementation can succeed through Raster while transparently retaining Vector failure.

## 58. One failure example

On the same page, `p1:g72` was Given lowercase `i`, font `MyriadPro-Regular-SC700`, glyph ID 42, font size 6.3, bbox x≈125.20523, y≈248.5343, width≈1.5057, height=6.3.

Vector again failed because the raw CFF font could not be parsed. The Raster crop was only 7×26 pixels; its tight ink was 2×17 pixels with aspect ratio 0.117647. Border-distance Otsu selected threshold 25. After aggressive enlargement/normalization, the CNN returned `|` 0.377999, `l` 0.276252, and `I` 0.263586. The top margin was 0.101747 and entropy 0.355253. Because both top probability and margin failed the acceptance thresholds, the result was `ambiguous`, not a confident disagreement.

The debug reference bank ranked lowercase `l` at 0.8925. The likely failure mechanism is loss of dot/stem and absolute-size context in a very narrow, low-resolution crop, compounded by an unavailable vector outline and the classifier’s known `I/l/|` family confusion. The correct behavior here is uncertainty preservation; the system did not solve the glyph. There was no Human confirmation to resolve it.

## 59. Code map

**Layer 1.1 additions:** `glyph_neural_model.py` and `neural_glyph_recognizer.py` now define/load fusion v2; `layer1_validation.py`, `validate_layer1_model.py`, and `approve_layer1_profile.py` implement measurement and promotion; `layer1AdmissionPolicy.js` implements the central boundary; `Layer1ValidationSample.js` and `Layer1ValidationProfile.js` implement validation persistence; `front/src/PDF/glyphChar/layer1Admission.js` is the downstream accessor; and `front/md/layer1.1-implementation-report.md` records the implementation milestone.

### Layer 1 code map

| Responsibility | Current files / principal functions or classes |
|---|---|
| Glyph extraction | `back/pdf-structure/forensic_analysis.py` — forensic page extraction, `get_texttrace()` normalization, font/operator inspection; `main.py::extract_page`; `native_extraction.py` for native document materialization |
| Given Char | `forensic_analysis.py` character Unicode serialization; `glyph_char_analysis.py::analyze_page` builds `given`; `glyph_char_analysis.py::_comparison` and `compare_visual_evidence` consume it only for comparison |
| Glyph geometry | `forensic_analysis.py` bbox/origin/page rotation conversion; `glyph_char_analysis.py::_finite_bbox`, `_crop_gray`; `front/src/PDF/glyphChar/GlyphSelectionOverlay.jsx` browser overlay |
| Vector morphology | `back/pdf-structure/vector_glyph_evidence.py` — font matching/loading, outline sampling, normalization, mask/features, caches |
| Vector recognition | `vector_glyph_evidence.py::analyze`; `neural_glyph_recognizer.py::_runtime`, `predict`, `predict_batch`, `_decode` |
| Raster crop | `glyph_char_analysis.py::analyze_page`, `_crop_gray`; PyMuPDF `Page.get_pixmap` |
| OpenCV preprocessing | `back/pdf-structure/opencv_glyph_evidence.py` — `analyze`, candidate generation/scoring, tight crop, normalization, morphology, stage serialization |
| Raster recognition | `opencv_glyph_evidence.py::recognize_deferred`; `neural_glyph_recognizer.py::_runtime`, `predict_batch`, `_decode`; `glyph_neural_model.py` architecture/constants |
| Model training/export | `train_glyph_classifier.py`; `glyph_neural_model.py`; independent artifacts `models/rabbit_glyph_raster_v2.torchscript.pt` and `models/rabbit_glyph_vector_v2.torchscript.pt`; v2 metadata and synthetic bootstrap report files |
| Model evaluation and validation | `benchmark_glyph_classifier.py`; `evaluate_exported_glyph_classifier.py`; `layer1_validation.py`; `validate_layer1_model.py`; `approve_layer1_profile.py`; versioned manifest/profile artifacts under `validation/` and `models/` |
| Human confirmation | `back/models/GlyphCharTrainingSample.js`; POST route in `GlyphCharAnalysisAPI.js`; `useGlyphCharAnalysis.js::trainSelectedGlyph`; confirmation controls in `GlyphCharAside.jsx` |
| Comparison | `back/pdf-structure/glyph_char_analysis.py::_comparison`, `compare_visual_evidence`; `front/src/PDF/glyphChar/glyphCharComparison.js`; `comparisonState.js` |
| Persistence | `back/models/GlyphCharAnalysisJob.js`; `GlyphCharAnalysisPage.js`; `GlyphCharVisualStage.js`; `GlyphCharTrainingSample.js`; `Layer1ValidationSample.js`; `Layer1ValidationProfile.js`; worker page/stage/admission persistence helpers |
| Admission boundary | `back/services/layer1AdmissionPolicy.js`; `front/src/PDF/glyphChar/layer1Admission.js`; typed states and fail-closed downstream accessor |
| API | `back/routes/GlyphCharAnalysisAPI.js`; mounted by `back/server.js`; validation profile/sample/adjudication routes; Python extraction/validation routes in `back/pdf-structure/main.py` |
| Python bridge | `back/helpers/pdfStructureService.js` |
| Background worker | `back/services/GlyphCharAnalysisWorker.js` — scheduling, batching, restart/resume, cancellation, deletion, profile attachment, and central admission evaluation |
| Frontend hook | `front/src/PDF/glyphChar/useGlyphCharAnalysis.js` — start, polling, hydration, pruning, selection, stages, confirmation, cancellation/deletion |
| Aside UI | `front/src/PDF/glyphChar/GlyphCharAside.jsx` and its CSS; mounted through `front/src/PDF/PDFPage.jsx` |
| Selection overlay | `front/src/PDF/glyphChar/GlyphSelectionOverlay.jsx`; `GlyphSelectionOverlay.test.js` |
| Frontend integration | `front/src/PDF/PDFPage.jsx`; PDF page/reader workspace components and CSS |
| Python tests | `back/pdf-structure/tests/test_glyph_visual_evidence.py` — 10/10 current direct tests pass |
| Backend tests | `back/test/glyphCharAnalysis.integration.test.js`; `back/test/layer1AdmissionPolicy.test.js`; `back/test/helpers/db.js`; direct admission assertions pass while package runners remain unavailable |
| Frontend tests | `glyphCharComparison.test.js`; `glyphPredictionCache.test.js`; `GlyphSelectionOverlay.test.js`; `layer1Admission.test.js`; `front/src/PDF/glyphForensics.test.js` |

Dependency versions observed in the active Python environment were PyMuPDF 1.28.0, OpenCV 5.0.0, fontTools 4.59.2, Torch 2.13.0+cu130, FastAPI 0.139.2, NumPy 2.5.1, and Pillow 12.3.0.

## 60. Final critical assessment

**Layer 1.1 revision:** The critical distinction is now between **instrument architecture** and **model validity**. The instrument architecture is materially stronger and downstream blocking is implemented. Model validity remains experimental because no adjudicated natural-PDF profile is approved.

### What is robust

- The evidence model keeps Given, Vector, Raster, and Human conceptually and structurally separate.
- Given and Human do not leak into production visual inference in the inspected implementation.
- Disagreement and unavailable evidence are retained rather than silently corrected.
- Exact per-character bboxes from PyMuPDF text traces replace equal-width span estimation.
- Raster preprocessing is deterministic, inspectable, fingerprinted, and stores visual stages separately; Raster identity now also receives masked typographic-relative measurements.
- Raster and Vector use independently versioned v2 artifacts, runtime caches, hashes, and prediction-source identities.
- Strong font-definition identity includes font-program hash, xref, and glyph ID; fallback identity is explicitly labelled.
- Open-set state is explicit and does not erase the nearest closed-set candidate needed for audit.
- The central admission policy fails closed: the current unapproved profile forces machine evidence to `OBSERVE_ONLY`, while explicit Human evidence remains `HUMAN_ASSERTED`.
- Analysis schema/model/hash/profile versioning, chunk completion flags, authenticated ownership checks, result pagination, and restart hydration provide a credible persistence foundation.
- Core independence, failure, selection, fusion-input, strong-identity, open-set-envelope, and fail-closed admission invariants have focused passing tests.

### What is functional but not yet robust

- All-document jobs resume and persist every ten pages, but the scheduler is process-local, nontransactional, and lacks distributed leases/backpressure.
- Cancellation and progress work at page boundaries, not at true in-page/glyph granularity.
- The UI can inspect rich evidence, but hydration/pruning/selection continuity and status filtering are incomplete.
- Vector extraction supports readable sfnt TrueType/OpenType, raw CFF, isolated Type1, and Type0/CID fallback paths, but broad binary-fixture coverage is incomplete and Type3 CharProc rendering remains unavailable.
- Caches are carefully bounded inside Python, yet page-per-child execution discards most cross-page benefit.

### What is experimental

- The v2 fusion models and knownness policy are experimental evidence generators. No adjudicated real-PDF accuracy or selective-risk estimate exists, so authoritative transcription is blocked.
- Temperature-scaled confidence is experimental because measured calibration generally worsened.
- Counter/contour morphology, vector sampled-mask construction, and legacy three-font similarity are useful diagnostic evidence, not validated character identity methods.
- Human-confirmation capture is an experimental dataset mechanism; no retraining loop consumes it.

### What is currently unreliable

- Uppercase/lowercase discrimination, especially V/v, W/w, O/o, S/s, C/c, X/x, and Z/z.
- Narrow glyph families such as I/l/|/1, and `0/o`.
- Tiny punctuation and marks remain a risk; typographic-relative evidence now mitigates scale loss, but no real-PDF validation measures the improvement.
- Vector evidence for malformed/unsupported embedded programs, unimplemented Type3 CharProcs, and insufficiently fixture-tested CFF/Type1/CID configurations.
- Confidence as a calibrated real-world probability.
- Sequence recognition for ligatures and combining characters; multi-code-point Given mappings are represented but are not visually decoded as arbitrary sequences.
- Multi-process job safety and memory behavior under many simultaneous large documents.

### What is not implemented

- Parsing and retaining `/ToUnicode`/font CMap provenance per glyph.
- Raw source-code preservation in the audited PyMuPDF path.
- Comprehensive, fixture-proven coverage for malformed and uncommon CFF/Type1/CID programs, plus Type3 CharProc canonical rendering.
- Sequence/ligature recognition or arbitrary Unicode output.
- Language, word, or semantic correction—deliberately outside Layer 1.
- A validated probabilistic consensus model; the current Vector and Raster recognizers are separate artifacts but their fusion architecture and synthetic bootstrap origin do not establish statistical independence.
- A production queue, leases, retries, dead-letter handling, immediate Python cancellation, or operational telemetry.
- Automated retraining and consumption of human-confirmed samples. A validation-profile promotion gate exists, but it is not a complete signed model registry/deployment system.

### What must be validated before Layer 2

1. Build a manually adjudicated, versioned corpus of naturally occurring PDFs spanning font technologies, scans, rotations, sizes, scripts, transparency, and damaged encodings.
2. Measure per-class precision/recall, selective accuracy versus coverage, calibration, document/font confidence intervals, and out-of-vocabulary rejection on that corpus.
3. Validate and formally approve the implemented Layer 2 admission policy thresholds on the frozen corpus; retain Human requirements and disagreement visibility.
4. Add immutable real regression fixtures for S/s/5, I/l/|/1, O/o/0, punctuation, spaces, ligatures, CFF, and rotated/vertical text.
5. Validate the implemented resource/xref/font-program-hash identity and definition deduplication across real pages, documents, subset fonts, and fallback cases.
6. Preserve raw encoded codes and per-glyph mapping provenance where technically obtainable.
7. Replace or harden the process-local scheduler and make page persistence transactional/idempotent under crashes and concurrent workers.
8. Profile CPU, memory, database size, and latency on large concurrent documents; add enforced budgets and telemetry.
9. Repair reproducible backend/frontend package test commands and add API/worker lifecycle integration tests.
10. Measure Raster/Vector error correlation and decide whether independent artifacts with the same fusion architecture require more strongly separated training data or model families.

**Audit verdict:** Layer 1.1 is a genuine, inspectable, fail-closed evidence system and a useful experimental foundation. It is not yet a validated machine character-authority layer. The preservation of uncertainty and provenance, explicit open-set envelope, and enforced admission boundary are strong enough for controlled evidence collection and Human assertion. Machine Layer 2 eligibility remains correctly blocked until classifier validity, font/domain coverage, Unicode/sequence behavior, calibration, operational architecture, and real-world selective risk are measured and an exact profile is approved.

---

# Extended audit dimensions

The original 60 sections audit the Layer 1 evidence pipeline itself. Sections 61–90 examine the security, privacy, reproducibility, governance, scientific-validity, interoperability, operational, and ethical qualities that determine whether that pipeline can be operated, reviewed, reproduced, and safely consumed. These are assessments of current repository behavior, not proposed features presented as implemented.

## 61. Security and abuse resistance

### Implemented controls

- Every public Glyph → Char Express route verifies a Bearer JWT using `JWT_KEY` and scopes Mongo queries by `userId`.
- Document start verifies that the requested `PDFDocument` belongs to the authenticated user.
- Job, visual-stage, confirmation, cancel, and delete operations all check job ownership.
- Mongo ObjectIds, page numbers, glyph IDs, one-character human labels, hydration limits, and visual-stage lookups receive explicit validation.
- CORS is allowlisted in `back/server.js`; accepted methods and headers are constrained and credentials are enabled deliberately.
- Express JSON input is capped at 10 MB.
- The Python service can require `X-Service-Key` through `PDF_STRUCTURE_SERVICE_KEY`. Cache filenames accept only plain alphanumeric document hashes, preventing direct path traversal.
- Python uploads use a temporary path before replacement, reducing partial-cache-file risk.
- Page pixels, traces, operators, result windows, chunk sizes, and hydrated glyph counts have bounds described earlier.

### Missing or weak controls

- The Glyph → Char routes have no route-specific request rate limiter. An authenticated user can repeatedly force page analysis and consume CPU, RAM, Mongo storage, and Python child processes.
- `activeJobs` has no global/per-user concurrency ceiling. This is the largest current denial-of-service risk.
- PDF parsing occurs in PyMuPDF, FontTools, OpenCV, and Torch without an OS-level sandbox, seccomp profile, read-only filesystem, process memory limit, or per-request CPU timeout documented in the repository.
- The Python Docker command binds `0.0.0.0`. If deployed without `PDF_STRUCTURE_SERVICE_KEY` or network isolation, its extraction/upload endpoints are unauthenticated.
- `/health` is intentionally unauthenticated. That is conventional, but deployment must avoid exposing unnecessary service metadata.
- No malware scanning, MIME/signature verification, maximum source-PDF byte limit specific to Layer 1, decompression-ratio guard, encrypted-PDF policy, or parser-vulnerability update process is present.
- No `helmet` middleware or explicit Content Security Policy is visible in the Express server.
- JWT verification confirms signature but the route itself does not enforce issuer, audience, token kind, or narrowly scoped permission claims.
- Error responses often expose raw internal exception messages, potentially revealing paths or parser details.

Security status: **authenticated and ownership-scoped, but not hardened against malicious documents or authenticated resource exhaustion**.

## 62. Privacy and data governance

Layer 1 can persist sensitive source-derived content: filenames/source linkage, decoded characters, font metadata, exact page coordinates, normalized glyph masks, OpenCV visual stages, model candidates, comparison states, and human corrections. These data can reconstruct portions of a document even when the original PDF is not returned.

Current deletion of analysis results removes the job, page chunks, and visual-stage rows. It deliberately retains `GlyphCharTrainingSample` records. Therefore “delete all results” is not a complete erasure of every derivative generated from the PDF. The UI and API should not imply otherwise. The Python PDF cache is also separate from Mongo deletion and has no Layer 1 deletion/retention endpoint or eviction policy.

The repository does not establish:

- retention periods for source PDFs, cached PDFs, analysis records, human labels, logs, or backups;
- backup deletion propagation or a verifiable right-to-erasure procedure;
- encryption-at-rest requirements for MongoDB/cache files;
- field-level encryption for extracted evidence;
- audit logging of who viewed, exported, confirmed, or deleted evidence;
- consent and secondary-use policy for human-confirmed samples;
- whether user samples may enter a future shared training corpus;
- data residency, breach response, or regulated medical-data controls.

Transport security depends on deployment TLS and service-network configuration; it is not enforced inside these modules. The shared Python service key protects service-to-service calls only when configured. Privacy status: **ownership checks exist, but retention, derivative deletion, training consent, encryption, and governance are unspecified**.

## 63. Reproducibility and provenance

**Layer 1.1 revision:** Jobs/profiles now retain Raster/Vector artifact and metadata hashes, all pipeline versions, validation profile, admission policy, training/corpus versions, Git commit where available, and dirty-worktree status. This corrects much of the old artifact-replacement ambiguity. Reproducible environment/container digest, dependency lock attestation, and immutable source corpus packaging remain incomplete.

The repository provides strong partial reproducibility evidence: pinned Python requirements, frontend/backend lockfiles, model metadata, model report, fixed training seed, dataset/preprocessing/vocabulary/calibration versions, TorchScript artifact, thresholds, and explicit audit commands/results.

It does not yet provide a complete reproducibility envelope. Schema 6 corrects the earlier artifact gap by persisting Raster/Vector artifact and metadata hashes, but output still lacks:

- source Git commit and dirty-tree fingerprint;
- exact OpenCV/PyMuPDF/FontTools/Torch runtime versions per job;
- operating system, architecture, CPU/GPU backend, and thread settings;
- training command, complete environment manifest, discovered font-file hashes, and artifact-build timestamp in one immutable manifest;
- deterministic-algorithm flags and proof that repeated training produces equivalent weights;
- a digest of the PDF bytes directly attached to every exported result object;
- a machine-readable audit bundle linking metrics to the exact model and benchmark corpus.

The Dockerfile improves service reconstruction but installs a broad Docling/Torch environment and does not pin the base image by immutable digest. The active local Python environment and container environment may therefore differ. Reproducibility status: **good version labeling, incomplete artifact/environment provenance**.

## 64. Operational observability

Current observability consists primarily of Morgan development request logs, console errors, Mongo job status/progress/error/heartbeat timestamps, `/api/health`, Python `/health`, and service health aggregation. Jobs expose attempts, resume count, active page, processed pages, counts, and timestamps.

Missing operational signals include:

- structured JSON logs with stable event names and correlation IDs spanning browser → Express → Python → Mongo;
- metrics for queue delay, page duration, glyph duration, render duration, model-load duration, cache hit/miss rate, font extraction failure, ambiguity rate, and persisted bytes;
- process RSS/heap, Python child count, Mongo latency, disk-cache size, and page-pixel distribution;
- Prometheus/OpenTelemetry integration, distributed tracing, dashboards, SLOs, and alerts;
- reason-coded counters for CFF failure, no foreground, model unavailable, cancellation delay, restart replay, and partial writes;
- separation of expected unavailable evidence from infrastructure errors;
- log redaction rules for filenames, text, JWTs, service keys, and exception payloads.

The job heartbeat is not updated continuously during one long extraction, so monitoring cannot reliably distinguish slow work from a stalled child. Observability status: **sufficient for local debugging, insufficient for production diagnosis or capacity management**.

## 65. Deployment architecture

The repository supports a two-service layout: Express/MongoDB as the authenticated orchestrator and a FastAPI/PyMuPDF service, with a Dockerfile for the latter. `PDF_STRUCTURE_URL` and optional `PDF_STRUCTURE_SERVICE_KEY` configure the connection. Express resumes pending jobs after Mongo connects. The Python service lazily loads Docling so native Layer 1 calls avoid unnecessary startup memory.

Operational gaps:

- no checked-in compose/Kubernetes deployment describes Mongo, Express, Python, persistent volumes, limits, or network policy together;
- the in-memory worker map is unsafe across multiple Express replicas and has no distributed lease;
- graceful shutdown behavior for active Glyph jobs is not defined;
- there are no readiness checks verifying model load, cache writability, Mongo indexes, or available disk—not merely HTTP liveness;
- Python cache storage may be ephemeral, causing large PDFs to be re-uploaded after deployment;
- no database migration framework or pre-deployment compatibility gate exists for analysis schema changes;
- no rolling-upgrade protocol prevents old and new workers from processing the same versioned job concurrently;
- the Docker image includes heavyweight transitive dependencies and potentially unused CUDA wheels, increasing cold-start/storage cost and attack surface.

Deployment status: **usable as a single-instance development/small deployment, not defined for safe horizontal scaling**.

## 66. Accessibility

The Layer 1 aside includes several useful semantics: a labeled `<aside>`, tablists/tabs with `aria-selected`, labeled sections, native `<progress>`, an accessible confirmation input, labels on destructive controls, and an accessible title for the normalized vector outline. Native buttons are keyboard-focusable.

Important gaps remain:

- `GlyphSelectionOverlay` is `aria-hidden="true"` and `pointer-events:none`; visual glyph boxes cannot be navigated or selected directly by keyboard or screen reader.
- Result virtualization uses absolutely positioned buttons. DOM reading order may remain logical, but no test verifies focus retention while filtering, pruning, or scrolling.
- Dynamic job status, newly hydrated results, cancellation, and errors are not comprehensively exposed through an `aria-live` region.
- Tabs do not visibly implement arrow-key roving behavior expected by the ARIA tabs pattern; they rely on ordinary Tab navigation.
- Morphology images need meaningful alternatives beyond technical stage names for nonvisual review.
- Dense, very small text sizes (many around 0.56–0.68 rem) can impair readability.
- Color communicates status heavily; the report found no automated contrast or color-blindness test for Layer 1.
- No automated axe/WCAG suite or screen-reader/manual keyboard test exists.

The wider workspace includes a `prefers-reduced-motion` rule, but Layer 1-specific transitions and progress behavior are not independently audited. Accessibility status: **partially labeled controls, inaccessible visual selection workflow, unvalidated WCAG compliance**.

## 67. Browser and device compatibility

The frontend officially targets modern production browsers through Browserslist and specifically the latest Chrome, Firefox, and Safari in development. PDF display uses PDF.js 3.11.174 while forensic extraction uses server-side PyMuPDF 1.28.0; geometry alignment therefore crosses two distinct rendering implementations.

The PDF workspace contains touch-action, portrait-orientation, pointer-event, and reduced-motion rules, showing explicit mobile/iPad concerns. Layer 1 nevertheless lacks automated cross-browser/device testing for:

- PDF.js/PyMuPDF bbox alignment at device-pixel ratios 1–3;
- Safari/iPad viewport changes, browser chrome, orientation changes, pinch zoom, and memory pressure;
- touch selection versus pen/annotation gesture ownership;
- Firefox/Chrome/Safari canvas antialiasing and overlay rounding;
- very narrow portrait aside layouts and virtualized result focus;
- offline/reconnect behavior during polling;
- browser heap limits on large pages and stage images.

Server-side recognition is browser-independent, but visual selection and evidence presentation are not. Compatibility status: **responsive CSS exists; Layer 1 cross-browser correctness is unvalidated**.

## 68. Data lifecycle and migrations

Layer 1 isolates current evidence by schema and recognizer version. That prevents old schema-2/schema-4/schema-5 records from masquerading as schema 6. Schema-6 identity also pins model and metadata hashes plus validation/admission versions. Page chunks use a completion flag, and delete is idempotent. These are sound primitives.

However, version changes currently behave as parallel/new records rather than managed migrations. There is no migration registry that documents field transformations, validates indexes, archives old jobs, reclaims obsolete visual stages, or recalculates storage. Old results can remain indefinitely. A guarded profile-approval CLI now exists, but there is still no complete operator workflow for model withdrawal, rollback, supersession, or unsafe-artifact quarantine.

Human confirmations are especially sensitive: they outlive result deletion and are joined by the new strong font-program/xref/GID definition identity where available, but fallback identities and cross-version propagation still need explicit migration policy. The Python PDF cache has no TTL/LRU cleanup. Mongo results and PDF cache can therefore diverge over time.

Lifecycle status: **version isolation is implemented; migration, archival, retention, rollback, and cross-store cleanup are not**.

## 69. Scientific evaluation methodology

**Layer 1.1 revision:** The implementation now separates synthetic benchmark from real-document validation, defines immutable partitions and governance, supports independent/double adjudication, computes selective/open-set/stratified metrics, and refuses silent profile approval. The corpus is empty, so this is valid methodology infrastructure without empirical conclusions.

The checked-in evaluation is stronger than an unmeasured prototype: it has held-out font-family splits, fixed seed, top-1/top-3, per-character results, confusion matrices, ambiguity/unpredictable rates, calibration statistics, a rendered-PDF benchmark, and controlled S regressions.

It is not yet a scientific validation of production PDF performance because:

- labels are generated from known rendering inputs rather than independently adjudicated from naturally occurring PDFs;
- the “real-PDF benchmark” exercises PDF rendering conditions but is still constructed from selected fonts/classes;
- font-family splitting reduces but does not prove independence between related font files/designs;
- no corpus sampling frame establishes representation of actual RabbitHole documents;
- no blinded annotation protocol, annotator count, inter-rater agreement, disagreement resolution, or label-error estimate exists;
- no confidence intervals, bootstrap intervals, hypothesis tests, or significance tests compare model versions;
- results are aggregated across sizes/fonts, which can hide catastrophic subgroups;
- there is no out-of-vocabulary/open-set benchmark, selective-risk curve, or cost-weighted error model;
- benchmark code and model live in the same repository, but no immutable external test set prevents tuning leakage.

A defensible validation plan must pre-register acceptance metrics, freeze a manually adjudicated test corpus, report stratified outcomes, and reserve an untouched final set. Scientific-validation status: **useful engineering measurements, not sufficient external validity**.

## 70. Explainability validity

The UI exposes excellent *evidence inspection*: source crop, grayscale image, blur, threshold, tight crop, normalized mask, edges, contours, morphology values, vector outline, candidates, and comparison. This allows a reviewer to inspect what entered the model and identify preprocessing failures.

It does not explain why the CNN selected one class. Contour count, counter estimate, debug Dice/IoU/shape similarity, and candidate list accompany the decision but are not causal feature attributions. The CNN consumes pixels; there is no saliency map, integrated gradients, concept activation, prototype retrieval from the actual training corpus, counterfactual test, or occlusion analysis. Even those methods would require faithfulness validation before being described as explanations.

The legacy three-font matcher can actively mislead if visually presented near production candidates without a prominent `debugOnly` distinction. Confidence is also not an explanation. Explainability status: **high preprocessing transparency, no validated model-decision explanation**.

## 71. Fairness and language coverage

Layer 1 is explicitly a Latin-print, 93-class closed-set head surrounded by an open-set envelope. It excludes accented Latin letters, most currency/math symbols, Greek, Cyrillic, Arabic, Hebrew, Indic scripts, CJK, Indigenous orthographies, combining marks, emoji, and specialist medical/scientific notation. Unsupported glyphs may still have an in-vocabulary nearest candidate for audit, but explicit knownness can reject that candidate and the unapproved profile prevents it from becoming an admitted Char.

Even within Latin print, the installed-font synthetic corpus can overrepresent common contemporary fonts and underrepresent dyslexia-oriented fonts, historical printing, low-vision fonts, OCR fonts, monospaced coding glyphs, handwriting, decorative faces, and damaged scans. The measured uppercase/lowercase failures are a systematic subgroup weakness. There are no fairness slices by script, language, font era, font accessibility purpose, source quality, or document origin.

Because scope is narrow by design, the immediate requirement is not to claim universal fairness. It is to validate unsupported-domain detection, expose vocabulary/version limits to users, and prevent downstream layers from interpreting rejection/misclassification as language-neutral evidence. Coverage status: **narrow declared vocabulary with explicit but empirically unvalidated open-set protection**.

## 72. Product behavior and human factors

The UI correctly separates Given, Vector, Raster, Human, and Comparison, but users can still misunderstand their epistemic status. Terms such as “confidence,” “MATCH,” “Human confirmation,” and “training sample” may imply authority or learning behavior that the system does not possess. In particular:

- `MATCH` means exact agreement between available strings, not correctness.
- a model score or knownness score is not a verified probability; schema 6 intentionally leaves calibrated confidence unavailable until real-PDF validation exists.
- Human confirmation is stored but does not retrain the active model.
- Vector and Raster are source-independent and use separate artifacts, but share architecture and related synthetic bootstrap data, so correlated error remains possible.
- resource-level `/ToUnicode` provenance is retained, but `perGlyphMappingProven=false` unless the exact raw-code association is available.
- deleting results retains human training samples and cached source PDFs.

No usability study tests whether users recognize ambiguity, inspect both channels, understand unavailable evidence, or avoid over-trusting green/matching states. Confirmation by definition key can propagate a user assertion beyond one occurrence, yet the collision/propagation scope is not obvious. Destructive deletion and cancellation have technical behavior that may differ from user expectations.

Human-factors status: **the data model is epistemically careful; user comprehension and automation-bias risk are unvalidated**.

## 73. Failure recovery and disaster testing

Current recovery mechanisms include completed Mongo page chunks, startup rescheduling of queued/processing jobs, idempotent result deletion, a one-time document re-upload after Python cache miss, temporary-file upload replacement, nonfatal evidence-channel failures, and explicit failed/cancelled job states.

The following disaster cases are not covered by automated tests or documented runbooks:

- Express termination during page extraction, between chunk insertion and completion marking, or during aggregate update;
- Python child crash, timeout, OOM kill, corrupted response, or service restart during a page;
- Mongo primary loss, write concern failure, partial replica recovery, duplicate-key race, or disk-full condition;
- two Express replicas resuming the same job;
- model/metadata mismatch, truncated TorchScript artifact, or incompatible Torch upgrade;
- corrupt/changed cached PDF under the same hash;
- cache directory full or unwritable;
- user cancellation concurrent with restart, completion, confirmation, or deletion;
- backup restore containing jobs without matching source files or vice versa.

There is no chaos test, fault-injection harness, recovery-time objective, recovery-point objective, or operator repair command for incomplete chunks. Recovery status: **basic restart continuation exists, but disaster consistency is unproven**.

## 74. Cost and capacity planning

The repository controls individual payloads but does not model total cost. A document can generate one instance record per glyph, page-level vector definitions, and multiple base64/image-like visual stages per visible glyph. Stage storage can dominate character metadata. Human samples add another normalized mask copy. The Python cache retains full PDFs without eviction.

Compute cost includes full-page PyMuPDF rendering, one OpenCV pipeline per visible instance, vector font parsing, debug reference matching, Torch model startup per child/page, inference, JSON serialization, and Mongo writes. The observed pages required roughly 15–21 seconds for 740–1,372 glyphs on the audit machine, but no hardware-normalized throughput or concurrency curve exists.

Missing capacity inputs include:

- bytes per glyph/page/document by collection;
- visual-stage compression ratio and retention policy;
- CPU-seconds and peak RSS by page complexity;
- model cold-start frequency and cross-page cache loss;
- Mongo index/storage growth and backup cost;
- network bytes between Express and Python and during frontend hydration;
- maximum sustainable concurrent users/jobs;
- quotas, billing guardrails, and cost alerts.

Capacity status: **local bounds exist, but there is no sizing model or safe concurrency target**.

## 75. Formal Layer 1 → Layer 2 boundary contract

**Layer 1.1 revision:** This previously missing contract is now implemented by `Layer1AdmissionDecision` and dedicated frontend accessors. Current policy states are `OBSERVE_ONLY`, `REVIEW_REQUIRED`, `ELIGIBLE_WITH_PROVENANCE`, and `HUMAN_ASSERTED`. No approved profile means machine output cannot cross the boundary.

The standalone, machine-enforced contract now exists in `back/services/layer1AdmissionPolicy.js`, is persisted as `admissionDecision`, and is exposed through the fail-closed frontend accessor in `front/src/PDF/glyphChar/layer1Admission.js`. Raw prediction fields remain visible for evidence inspection, so code review and tests must continue enforcing the invariant that downstream Layer 2 consumers use only the admission accessor.

A safe boundary must require an immutable envelope containing at least:

```text
document hash and page/glyph identity
schema, recognizer, model, vocabulary, preprocessing, and calibration versions
geometry plus geometry method/confidence
Given evidence and mapping provenance limitations
Vector status/prediction/candidates/failure reason
Raster status/prediction/candidates/failure reason/fingerprint
Human assertion with source/time/scope
comparison/evidence state
explicit admissibility decision and reason
```

Implemented schema-6 admissibility classes are:

- `OBSERVE_ONLY`: unavailable, no-visible, unsupported vocabulary, geometry uncertainty, or unresolved source failure;
- `REVIEW_REQUIRED`: ambiguity, Vector/Raster disagreement, Given/visual disagreement, weak calibration region, or propagated Human label;
- `ELIGIBLE_WITH_PROVENANCE`: validated model/version, supported class, acceptable uncertainty, trustworthy geometry, and no unresolved disagreement;
- `HUMAN_ASSERTED`: explicit human evidence, still retained separately and never rewritten as model output.

Layer 2 must not feed semantic expectations back into Layer 1 records, replace candidates with context-corrected text, collapse disagreement, or reinterpret missing evidence as a negative observation. Any contextual correction belongs in a new downstream object linked to—not overwriting—the Layer 1 instance.

Boundary status: **admissibility rules and enforcement are implemented; machine admission remains intentionally blocked because the current validation profile is unapproved**.

## Extended-audit conclusion

The added dimensions now refine the original technical verdict. Layer 1.1 is inspectable, evidence-separated, uncertainty-aware, and protected by an enforced Layer 2 admission policy. Production readiness remains constrained by malicious-PDF exposure, incomplete erasure semantics, weak operational telemetry, single-process job ownership, limited accessibility, unvalidated browser geometry, migration/retention governance, and absent scientific external validity.

Before Layer 2 relies on this evidence, the highest-priority non-recognition work is:

1. enforce per-user/global job quotas, process limits, timeouts, and Python service authentication/network isolation;
2. define complete deletion/retention behavior across Mongo, human samples, logs, backups, and the Python PDF cache;
3. extend the now-persisted artifact/model hashes with code-commit, runtime-environment, and signed-generation provenance;
4. implement structured metrics/tracing and a multi-instance-safe durable job lease;
5. populate, freeze, and independently adjudicate the implemented real-document validation corpus;
6. test keyboard/screen-reader access and cross-browser bbox alignment;
7. validate and approve the already enforced Layer 1 → Layer 2 admissibility contract without weakening its current fail-closed behavior.

## 76. Dependency and software-supply-chain risk

Layer 1 depends on executable code from npm, PyPI/container repositories, a browser CDN, and the checked-in TorchScript model. Python requirements are version-pinned and frontend/backend lockfiles retain resolved package URLs and integrity metadata. The model and metadata are repository artifacts rather than downloaded dynamically at inference time. These are useful controls.

Current supply-chain weaknesses are:

- the PDF.js worker is loaded from cdnjs with a protocol-relative URL and no Subresource Integrity attribute or self-hosted immutable asset; compromise/unavailability can affect PDF Reader execution;
- the Docker base `python:3.12-slim` is tag-pinned, not digest-pinned;
- no SBOM, dependency inventory artifact, provenance attestation, package signature policy, or image signature is generated;
- no automated npm/Python/container vulnerability scan or dependency-review gate is visible;
- the backend currently has declared test dependencies that are not reproducibly installed in the active environment, demonstrated by the missing Mocha binary;
- broad dependencies such as Docling bring a large transitive graph into the same Python image even though the Layer 1 job disables Docling;
- TorchScript deserialization executes a trusted model program. The code checks path existence but not artifact SHA-256/signature before `torch.jit.load`;
- model metadata and model weights are separate files without a cryptographic binding;
- installed fonts become training inputs, but font-file provenance/hashes are not frozen in a supply-chain manifest.

Required controls include self-hosting the PDF.js worker, producing CycloneDX/SPDX SBOMs, digest-pinning images, scanning lockfiles/images, hashing/signing the model+metadata bundle, minimizing the inference image, and making clean-install test execution part of CI. Supply-chain status: **partly pinned, not attestable or continuously verified**.

## 77. Data integrity and transactional consistency

Integrity primitives already present include document hashing, alphanumeric cache filenames, temp-file PDF cache writes, versioned job identity, unique job index, deterministic page/chunk ordering, chunk numbers/counts, `complete` flags, stage fingerprints, and idempotent result deletion.

The page write protocol is nevertheless nontransactional:

```text
delete previous page/stages
→ insert visual stages
→ insert incomplete page chunks
→ mark page chunks complete
→ recalculate/update job aggregate
```

A crash can leave orphan stages, incomplete chunks, no previous valid page, or a completed page whose aggregate job counters lag. There is no Mongo transaction or commit record covering the whole page. Reads correctly ignore incomplete page chunks, but no repair task removes incomplete/orphan records or reconstructs aggregates automatically.

Other integrity gaps:

- Python cache hits trust the hash-named file’s existence without rehashing its bytes on every extraction;
- model artifact and metadata are not digest-bound;
- visual stages and inline morphology share a fingerprint but no stored payload checksum verifies stage corruption;
- `Mixed` Mongo fields permit malformed or version-incompatible nested evidence;
- `definitionRef` can collide across font resources;
- Human confirmation propagation can therefore attach a valid label to the wrong definition;
- there is no export-level Merkle/digest chain proving that a result set is complete and unmodified.

Integrity status: **defensive identifiers and completion flags exist, but atomic page commits and automatic consistency repair do not**.

## 78. Concurrency and distributed-systems semantics

The current job semantics are effectively *at least once by page/batch*, not exactly once. Express schedules work with `setImmediate`; a process-local `activeJobs` map prevents duplicate execution only inside one Node process. Startup resets processing jobs to queued and schedules them. Completed page numbers are skipped, while pages from an unsaved batch may be repeated.

Race conditions requiring explicit treatment include:

- two start requests can contend on the unique job identity; duplicate creation is caught by re-querying, but subsequent force/reset/update behavior can still interleave;
- two Express replicas can both resume and process the same job because there is no atomic lease owner/expiry;
- cancellation changes Mongo state, while a Python call continues and may race with result saving;
- deletion waits on process-local activity, which cannot observe another replica’s worker;
- per-page force reanalysis deletes that page’s records while another worker could still hold extraction output;
- confirmation can read a source glyph while deletion/reanalysis replaces its page;
- aggregate recalculation can race with another page writer;
- heartbeat staleness is not used as a compare-and-swap lease.

The API is partly idempotent—GET and repeated delete are safe, and completed pages are reusable—but start, force-page, confirmation, and background execution lack a documented idempotency-key/lease protocol. A robust design needs a durable queue or Mongo lease with owner token, lease expiry/renewal, compare-and-swap state transitions, generation number, and generation-scoped writes. Concurrency status: **acceptable only under the current single-Express-worker assumption**.

## 79. Model governance

**Layer 1.1 revision:** Separate model artifacts/metadata, SHA-256 hashes, validation profiles, source-corpus and pipeline versions, explicit approval identity/time, and a refusing approval CLI now exist. The current profile remains unapproved. Missing items include a populated governed corpus, production role authorization for approval, rollback registry, signed artifacts, and incident/withdrawal workflow.

The repository records model name/version, training dataset version, vocabulary version, preprocessing version, calibration version, thresholds, report metrics, and a TorchScript artifact. Persistence keys include recognizer/schema versions, protecting old and new outputs from accidental mixing.

No governance workflow defines:

- who may approve a model for use;
- minimum accuracy/calibration/selective-risk thresholds;
- protected real-document regression gates;
- artifact hash/signature and immutable registry location;
- development, candidate, approved, deprecated, withdrawn, and rolled-back states;
- compatibility between model, metadata, preprocessing code, schema, and frontend presentation;
- rollback behavior for active jobs and evidence already persisted;
- documentation of training data rights, intended use, excluded use, subgroup performance, and known harms in a formal model card;
- change-control review for threshold-only modifications;
- monitoring criteria that trigger withdrawal after deployment.

Current constants act as informal release control, but a developer can replace the artifact without changing the version and silently invalidate cache/provenance assumptions. Governance status: **rich metadata, no enforced promotion or artifact-control process**.

## 80. API contract governance

The Express routes use consistent JSON envelopes and status codes for many validation/ownership cases. Pagination is bounded, deletion is deliberately idempotent, and the Python service uses Pydantic request models for JSON extraction calls.

However:

- there is no checked-in OpenAPI contract for the Express Layer 1 API;
- route responses are assembled ad hoc and are not validated against schemas before transmission;
- Mongo `Mixed` evidence passes through without a strict public response validator;
- the API path has no explicit `/v1`; compatibility depends on schema/model fields inside payloads;
- pagination ordering exists in implementation but is not published as a stable contract with cursor semantics;
- errors have no stable machine-readable code taxonomy beyond message/status;
- frontend client types are not generated and JavaScript provides no compile-time contract checking;
- no consumer-driven contract tests cover old/new frontend-backend combinations;
- no deprecation headers, version negotiation, changelog, or compatibility window is defined;
- Python and Express contracts can drift independently.

The report’s section 56 documents the effective contract, but documentation is not enforcement. API-governance status: **functional private API with bounded pagination, not a formally versioned or schema-validated interface**.

## 81. Code quality and maintainability

Layer 1 benefits from meaningful module separation: forensic extraction, raster evidence, vector evidence, neural inference, training/evaluation, worker, models, API, client hook, aside, overlay, and comparison each have identifiable files. Constants and evidence versions are named, and comments explain several non-obvious memory/resume choices.

Maintainability concerns include:

- `PDFPage.jsx` is over twenty thousand lines and owns Layer 1 integration alongside many unrelated reader functions, making regressions and review difficult;
- `useGlyphCharAnalysis.js` combines server polling, local fallback analysis, hydration, pruning, selection, stages, confirmation, cancellation, and deletion;
- evidence has related but different Python, Mongo, API, and browser shapes without shared schemas/types;
- legacy browser/OpenCV similarity paths coexist with the neural authoritative path, increasing semantic confusion and test burden;
- numerous version strings/cache keys are manually coordinated across languages;
- Mongo `Mixed` fields move validation burden into application code;
- background scheduling/persistence/state transitions live in one worker module without an explicit state machine;
- test launchers are currently inconsistent/missing despite test source being present;
- no static type checker covers the frontend/backend Layer 1 contract;
- comments refer to historical behavior and can drift from executable semantics.

Recommended structural work includes extracting a typed Layer 1 contract package, splitting PDF page integration, implementing a job state-machine/lease repository, isolating legacy debug features, and adding complexity/dead-code/static-analysis gates. Maintainability status: **modular core algorithms embedded in a highly complex application integration layer**.

## 82. Licensing and intellectual-property review

Layer 1 redistributes or executes third-party libraries, an externally hosted PDF.js worker, a trained model, icon assets elsewhere in the PDF UI, and font programs used for synthetic training. The repository’s dependency manifests identify packages but this audit found no Layer 1-specific third-party notices, SBOM/license report, font-training provenance ledger, or model licensing statement.

Required review areas are:

- licenses and distribution obligations for PyMuPDF, MuPDF, OpenCV, FontTools, PyTorch, PDF.js, FastAPI, Express, Mongoose, Pillow, NumPy, and all transitive dependencies;
- whether the chosen PyMuPDF/MuPDF licensing arrangement is compatible with the application’s distribution/deployment model;
- license/terms for cdnjs-hosted PDF.js delivery;
- rights to render installed fonts into a training corpus and distribute weights derived from them;
- rights to extract and inspect embedded PDF fonts while respecting PDF/document ownership;
- attribution requirements for icons and UI assets;
- ownership/consent terms for user-created Human confirmation samples and any future model trained from them;
- license metadata and redistribution terms for `rabbit_glyph_cnn_v1.torchscript.pt`.

This is an engineering inventory, not a legal conclusion. A qualified license review must determine obligations for the actual distribution and hosting model. Licensing status: **dependencies and training sources are identifiable, but compliance evidence is not assembled**.

## 83. Configuration and secret management

Layer 1 depends directly on at least `DB_CONNECTION_LOCAL`, optional `DB_NAME`, `JWT_KEY`, `PDF_STRUCTURE_URL`, optional `PDF_STRUCTURE_SERVICE_KEY`, and Python `PDF_CACHE_DIR`. Uvicorn deployment also uses `PORT`. Defaults make local development easy: Python defaults to localhost:8002 and a local cache directory.

Security/operational weaknesses include:

- no Layer 1 startup schema validates all required environment variables and their format;
- Express does not fail fast with a clear Layer 1 diagnostic when `JWT_KEY` or database configuration is absent/invalid;
- Python service authentication is opt-in: an empty `PDF_STRUCTURE_SERVICE_KEY` disables the check;
- no secret rotation/version mechanism supports overlapping old/new service keys or JWT signing keys;
- no documented separation of development/test/production secrets, secret-manager integration, or least-privilege database credential;
- service URLs are plain HTTP by default and trust deployment/network isolation;
- no configuration snapshot/digest is attached to a job, so operators cannot prove which thresholds/URLs/security mode applied;
- logs and raw exception propagation lack a formal secret-redaction test;
- CORS allowlisting is code-based and requires deployment changes for new trusted origins.

Configuration should be validated before accepting traffic, with production refusing an empty service key, weak/missing JWT key, nonapproved CORS origin, or unwritable cache. Secret values must never be persisted in jobs; only a nonsecret configuration profile/version should be recorded. Configuration status: **convenient defaults, insufficient fail-fast production policy and rotation support**.

## 84. Auditability and chain of custody

**Layer 1.1 revision:** Exact model/metadata digests, Git/dirty state, validation profile, admission policy, stronger definition identity, and Human actor/scope/instance provenance are now retained. The broader finding still stands: Mongo evidence is mutable and there is no tamper-evident append-only event chain or signed export bundle.

Current evidence retains useful lineage: user/document/source/job/page/glyph IDs, document hash at job level, schema/recognizer/model/preprocessing versions, geometry method, source channel, fingerprints, timestamps, Human label source, and comparison. These fields can reconstruct much of the computational path.

They do not form an immutable chain of custody. Mongo records are mutable/deletable; there is no append-only event log recording start, page reservation, extraction completion, stage persistence, model invocation, human inspection, confirmation replacement, cancellation, deletion, export, or downstream consumption. The system records the latest active Human confirmation rather than a complete user-visible decision history. There is no actor/device/session record for inspection events and no signed evidence bundle.

The following facts cannot currently be proven after the fact:

- the exact Git commit and runtime environment that generated a prediction; schema 6 now does preserve exact model/metadata artifact hashes;
- whether a persisted nested `Mixed` payload was modified after creation;
- who viewed or exported an evidence record;
- whether deletion removed every derivative/cache/backup;
- which Layer 2 process consumed a specific Layer 1 generation;
- whether a Human confirmation was propagated to another occurrence and why;
- whether a result was produced before or after a configuration/model file replacement that retained the same version string.

For formal auditability, use append-only reason-coded events, immutable generation IDs, artifact hashes, actor IDs, and signed export manifests. Chain-of-custody status: **good diagnostic provenance fields, no tamper-evident event history**.

## 85. Export and interoperability

The REST results endpoint returns JSON that could be saved manually, and section 56 documents the current object shape. Geometry uses page-space coordinates and evidence keeps source distinctions. This provides a basis for interoperability.

There is no dedicated Layer 1 export/import facility. Missing capabilities include:

- one command/API to export a complete job across all paginated chunks, vector definitions, visual stages, Human samples, job metadata, model metadata, and source-document digest;
- a stable JSON Schema and media type;
- an export manifest with counts/checksums proving completeness;
- coordinate-system declaration sufficient for independent overlay reproduction;
- external identifiers compatible with PDF object/font resource references;
- W3C Web Annotation, ALTO, PAGE XML, hOCR, IIIF, or another interoperability mapping;
- re-import validation and conflict behavior;
- redacted export profiles excluding document text/masks/private metadata;
- independent command-line verifier for hashes, candidates, and schema compatibility.

The current paginated API is optimized for the UI, not archival exchange. Export status: **JSON-accessible but not losslessly packaged, standardized, or independently verifiable**.

## 86. Temporal correctness and evidence generations

**Layer 1.1 revision:** Schema-6 jobs pin artifact hashes and complete pipeline/profile versions, substantially reducing same-version model replacement ambiguity. A job-wide immutable generation ID, signed configuration snapshot, and explicit supersedes/withdrawal relations are still absent.

Jobs and records have timestamps, schema/recognizer versions, and restart counters. Current-version lookup prevents some stale hydration. These measures do not fully define temporal semantics.

Potential temporal failures include:

- replacing model weights without changing `modelVersion` is detected by the persisted artifact hash, but deployment policy still must reject unregistered hash/version combinations;
- changing code/thresholds under the same recognizer string has the same problem;
- a job pins model artifacts and profile versions but can still span an unpinned application-code/runtime deployment change;
- a source file could theoretically change while retaining/reusing metadata unless byte hash verification is consistently enforced;
- Human confirmations are attached by latest `updatedAt` and definition key, potentially applying a later assertion to evidence generated earlier;
- clients polling during force reanalysis can temporarily combine old hydrated glyphs with new job status unless generation identity is explicit;
- system clock skew across Node, Python, Mongo, and clients can make timestamps unreliable ordering evidence;
- no “valid from/withdrawn at/supersedes” relationship connects model/result generations.

Every analysis should retain its existing immutable source/model/metadata/profile hashes and additionally pin code commit, runtime image/configuration, and a job-wide generation ID at creation. All page/stage/human/downstream records should reference that generation. Temporal status: **artifact/profile point-in-time identity exists, but full code/runtime generation semantics are incomplete**.

## 87. Internationalization and localization

The Layer 1 interface and technical states are hardcoded in English: scope labels, action buttons, progress text, evidence cards, filters, errors, training instructions, and accessibility labels. No translation catalog or locale abstraction is used in the inspected glyph components.

Technical limitations interact with UI localization:

- the classifier vocabulary itself is Latin-print only;
- no right-to-left or vertical-script evidence layout is tested;
- `Array.from` correctly counts Unicode code points for Human confirmation, but one code point is still not equivalent to one grapheme cluster;
- locale-aware rendering of percentages, decimal values, dates, and counts is not consistently specified;
- monospaced glyph displays and small panels may not support fallback fonts for all Unicode labels;
- state terms such as Given, Vector, Raster, ambiguity, and no-visible-glyph require controlled translations to preserve epistemic meaning;
- error text returned directly from backend/Python cannot be localized reliably;
- screen-reader labels are English-only.

Internationalization status: **English-only interface coupled to a narrow Latin model; Unicode transport is broader than actual recognition/UI validation**.

## 88. Documentation quality and operational runbooks

The implementation contains valuable inline comments, Python README/requirements notes, `back/python.md` startup commands, model metadata/report files, tests, and this audit. The service inventory and code map now provide substantial technical orientation.

Documentation gaps remain:

- no single supported local/production startup document covers frontend, Express, Mongo, Python, required secrets, source storage, and health verification;
- `python.md` starts Uvicorn but does not by itself define model validation, cache permissions, service-key security, or Express dependency;
- no OpenAPI/JSON Schema reference documents public evidence fields and status semantics;
- no job-state diagram, sequence diagram, data-retention diagram, or failure-recovery runbook exists as executable/current documentation;
- no model card/dataset card explains intended scope and exclusions;
- no operator procedure covers stuck jobs, incomplete chunks, cache cleanup, model rollback, Mongo restoration, or port conflicts;
- test commands are not currently reproducible from package scripts in the active installation;
- no documentation CI checks code links, commands, schemas, or version strings for drift.

Documentation status: **strong forensic comments and audit narrative, weak installation/operations/contract maintenance**.

## 89. Environmental efficiency

Several existing choices reduce waste: results persist across reloads, completed pages resume, source PDFs upload only after cache miss, page pixels are capped, inference batches deferred raster masks, within-process predictions are cached, result hydration is paginated, and visual stages load lazily.

Significant inefficiencies remain:

- a fresh Python child/page commonly reloads TorchScript and discards cross-page caches;
- every analyzed page is rendered as a full grayscale pixmap even if only limited glyph regions are needed;
- per-glyph debug similarity work is retained despite not controlling production identity;
- multiple visual stages per glyph amplify CPU, serialization, database, backup, and network storage;
- all-document analysis can process every repeated instance even when definition-level reuse could be stronger;
- the Python image includes Docling and possibly CUDA-related packages unused by Layer 1 jobs;
- no CPU thread/concurrency policy prevents inefficient oversubscription;
- no carbon/energy metric, storage TTL, deduplication ratio, or workload scheduling policy exists.

High-value efficiency improvements are a long-lived inference worker/model, cross-page content-addressed mask cache, optional debug-stage retention, stage compression/deduplication, a Layer 1-minimal CPU image, and measured throughput-per-watt/storage-per-document. Environmental status: **some memory/network bounds, substantial repeated compute and storage amplification**.

## 90. Ethical and clinical-use boundaries

**Layer 1.1 revision:** The admission gate materially reduces automation risk: current machine evidence is technically blocked as `OBSERVE_ONLY`, open-set rejection is visible, and agreement is no longer labelled correctness. This is not a clinical safety case; Human assertions, downstream use, corpus governance, and intended-use validation still require formal controls.

RabbitHole’s broader context includes patient/medical functionality, so a character error may propagate into clinically meaningful text even though Layer 1 itself performs no semantic reasoning. The architecture’s separation of evidence, uncertainty, and Human assertion is ethically preferable to silent correction, but it does not by itself make downstream use safe.

Current risks include:

- users or downstream code treating `MATCH` or high confidence as verified document truth;
- wrong case/digit/punctuation changing drug names, doses, units, negation, identifiers, or clinical statements;
- unsupported scripts/fonts receiving plausible in-vocabulary hallucinations;
- automation bias caused by green/accepted states and technical confidence values;
- Human confirmation propagation beyond the exact occurrence;
- retention of document-derived masks/labels without a complete consent/deletion policy;
- future training on user corrections without explicit governance;
- unequal performance across languages, fonts, historical documents, and accessibility-oriented typography;
- lack of a formal requirement that consequential use be checked against the original PDF.

No claim, certification, or validation in the repository establishes Layer 1 as a medical device, diagnostic system, clinical transcription authority, or substitute for source-document review. Before any consequential clinical use, the product needs explicit intended-use/excluded-use statements, human-review requirements, risk analysis, traceable correction handling, validated performance for the intended population, incident reporting, and applicable legal/regulatory review.

Ethical-use status: **appropriate uncertainty-preserving architecture, no validated safety case for clinical reliance**.

## Complete 90-dimension conclusion

Across all 90 dimensions, RabbitHole Layer 1.1 now has two coherent strengths: it preserves distinct evidence, and it enforces that unvalidated machine evidence cannot silently become downstream Char. Typographic-relative measurement, explicit open-set rejection, strong font identity, artifact hashes, validation-profile provenance, and centralized admission correct major weaknesses identified by the schema-5 audit.

The scientific verdict remains conservative. The v2 artifacts are synthetic bootstrap exports; the real-PDF adjudication corpus is empty; selective risk, calibration, open-set error, font/script coverage, and confusion-family performance are unknown. Type3, operational hardening, transactional consistency, distributed job ownership, deletion semantics, accessibility, signed chain of custody, reproducible deployment, and clinical validation remain incomplete.

The implementation is suitable for continued research, inspection, controlled evidence collection, and explicit Human assertion. It is **not** suitable for machine Layer 2 admission under the current profile. Current effective boundary:

```text
Machine evidence → OBSERVE_ONLY
Human confirmation → HUMAN_ASSERTED
ELIGIBLE_WITH_PROVENANCE → unavailable until explicit real-PDF profile approval
```
