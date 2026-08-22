# RabbitHole Layer 1.1 — Implementation Report

## FILES CREATED

- `back/pdf-structure/layer1_validation.py`
- `back/pdf-structure/validate_layer1_model.py`
- `back/pdf-structure/approve_layer1_profile.py`
- `back/pdf-structure/validation/real_pdf_manifest.json`
- `back/pdf-structure/models/rabbit_glyph_raster_v2.torchscript.pt`
- `back/pdf-structure/models/rabbit_glyph_vector_v2.torchscript.pt`
- v2 model metadata, synthetic report, and conservative validation-profile artifacts under `back/pdf-structure/models/`
- `back/services/layer1AdmissionPolicy.js`
- `back/models/Layer1ValidationSample.js`
- `back/models/Layer1ValidationProfile.js`
- `back/test/layer1AdmissionPolicy.test.js`
- `front/src/PDF/glyphChar/layer1Admission.js`
- `front/src/PDF/glyphChar/layer1Admission.test.js`

## FILES MODIFIED

- Python forensic extraction, page analysis, OpenCV evidence, vector evidence, neural model/runtime, trainer, and regressions.
- Mongo job/page schemas, worker, and result/adjudication API.
- GLYPH → CHAR aside, comparison contract, CSS, and frontend tests.

## SCHEMA / RECOGNIZER VERSION CHANGES

- Persisted schema: `5` → `6`.
- Recognizer envelope: `glyph-neural-rabbit-cnn-v1-preprocess-v2` → `glyph-identity-fusion-v2`.
- Raster/vector model: independent `v2` contracts.
- Vocabulary: `latin-print-open-set-v2`; preprocessing: `opencv-proportional-typographic-v3`; typographic features: `typographic-relative-v1`; open set: `explicit-knownness-energy-v1`; admission: `layer1-admission-v1`.
- Jobs are keyed by schema and recognizer, so schema-5 rows do not hydrate as schema 6.

## TYPOGRAPHIC-RELATIVE EVIDENCE

### Raster features

The original normalized mask is retained. The additional masked feature vector contains bbox/font-size ratios, raw-crop and ink dimensions relative to expected font pixels, baseline-relative top/bottom, and provenance-only origin data. Absolute page location is not identity input.

### Vector features

When supplied by the embedded font: units/em, advance/em, bearings/em, ascender, descender, x-height, cap-height, glyph em bounds, width/em, height/em, and cap-or-x-height ratio.

### Missing-value handling

Unavailable values remain `null`. `GlyphIdentityModel` receives a parallel feature mask and concatenates that mask to the masked measurements; missing measurements are therefore not interpreted as real zero measurements.

## RASTER MODEL V2

### architecture

Four-stage CNN image encoder + masked typographic MLP + fusion layer + closed-set character head + explicit knownness head.

### input mask

One normalized `64×64` inference tensor derived from the preserved 96×96 OpenCV specimen.

### typographic feature input

16 measurements plus a 16-value availability mask.

### training data

Installed-font synthetic specimens, non-Latin/symbol/ligature negatives, and blank, clipped, overlapping, noise, and border corruption negatives. No PDF Given or ToUnicode labels are used. This is synthetic training, not real-PDF validation.

### model SHA-256

`ded0244ce803a957d2683a4aa68c8f5022e1bd1ab3bd713079bc8e9a6dd2c372`

## VECTOR MODEL V2

### architecture

Software-separable instance of the same fusion architecture. It has independent artifact, metadata, runtime cache, model name, digest, and prediction source.

### input

Canonical embedded-font outline mask plus font-program typographic metrics and missing-value mask.

### model SHA-256

`7531d6253ff61b5015689456838798a2dffe54266c649919078bec205871fc0b`

## OPEN-SET RECOGNITION

### method

An explicit knownness head produces acceptance/rejection independently from the closed-set softmax. Energy and nearest closed-set candidates remain observable. Outputs are `IN_VOCABULARY`, `OUT_OF_VOCABULARY`, `OPEN_SET_UNCERTAIN`, or `UNAVAILABLE`.

### training negatives

Greek, Cyrillic, Arabic, Hebrew, mathematical/currency/arrow symbols, ligatures, blank crops, clipping, overlap, noise, and border fragments where renderable.

### thresholds

Current synthetic bootstrap metadata uses knownness review boundaries 0.35/0.62. They are not downstream admission thresholds. Production admission remains blocked until real-PDF validation supplies approved selective-risk thresholds.

### validation metrics

Not measured: the adjudicated real-PDF corpus contains 0 samples. FAR, FRR, and AUROC must not be fabricated.

## FONT SUPPORT

### TrueType

Implemented through FontTools sfnt extraction.

### OpenType

Implemented for readable sfnt OpenType programs.

### CFF

Raw CFF adapter implemented with `CFFFontSet`; support depends on the extracted program and charset/GID consistency.

### Type1

Isolated FontTools `T1Font` provider implemented. Fixture coverage is still required before claiming broad support.

### CID

Type0/CID descendant provider preserves resource identity and attempts sfnt, then raw CFF extraction.

### Type3

Detected explicitly. CharProc rendering is not yet implemented, so the provider returns an honest precise unavailable result and never substitutes a host font.

### unsupported cases

Missing programs, invalid GIDs, malformed fonts, unsupported Type3 CharProcs, and parser failures remain `Vector.available=false` with reasons.

## FONT DEFINITION IDENTITY

### old key

`fontName:glyphId`.

### new key

`fontdef:<fontProgramSha256>:<fontXref>:<glyphId>`. Fallback identities are explicitly marked `definitionIdentityConfidence=fallback`.

### collision tests

Identity and caches include program hash/xref/GID, preventing same-name/same-GID definitions from sharing strong identity. Dedicated binary font fixtures remain to be added for every font technology.

## GIVEN-CHAR PROVENANCE

### raw code support

PyMuPDF texttrace does not expose original encoded bytes per glyph; values remain unavailable rather than inferred.

### ToUnicode support

Resource-level `/ToUnicode` references are retained, with `perGlyphMappingProven=false` unless raw association becomes available.

### encoding/CMap provenance

States include `EXPLICIT_TOUNICODE`, `SIMPLE_FONT_ENCODING`, `PREDEFINED_CMAP`, `CID_MAPPING`, `EXTRACTOR_FALLBACK`, and `UNKNOWN_MAPPING_PATH`. Provenance never changes Given value.

## REAL-DOCUMENT VALIDATION CORPUS

### number of documents

0.

### number of glyphs

0 adjudicated glyphs.

### adjudication method

Mongo schema and API support separate reviewer records, known/unknown/multi/no-visible/unresolvable labels, two-review resolution, immutable partitions, strata, crop references, and governance. Production Given evidence is stored only as evidence, never the validation label.

### corpus version

`real-pdf-corpus-unpopulated-v1`.

## VALIDATION RESULTS

- top-1: unavailable
- top-3: unavailable
- selective accuracy: unavailable
- coverage: unavailable
- risk/coverage: unavailable
- ambiguity: unavailable
- unpredictable: unavailable
- open-set false acceptance: unavailable
- open-set false rejection: unavailable
- calibration: unavailable
- Vector availability: unavailable

All are intentionally null until frozen, manually adjudicated natural-PDF samples exist.

## MOST COMMON CONFUSIONS

Not measured on real documents.

## S/s RESULTS

The historical S fixture remains a regression. The architecture now receives case-relevant typographic evidence, but real-PDF S/s rates remain unmeasured.

## I/l/1/| RESULTS

Tracked as a known-risk family; no real-PDF result exists yet.

## O/o/0 RESULTS

Tracked as a known-risk family; no real-PDF result exists yet.

## VALIDATION PROFILE

### version

`layer1-real-pdf-unapproved-v1`.

### model hashes

Raster/vector hashes are frozen above; metadata contains its own canonical digest.

### approvedForDownstream

`false`. The approval CLI refuses promotion without a versioned measured real-PDF corpus and both artifact hashes.

## LAYER 1 ADMISSION CONTRACT

### states

`OBSERVE_ONLY`, `REVIEW_REQUIRED`, `ELIGIBLE_WITH_PROVENANCE`, `HUMAN_ASSERTED`.

### rules

No approved profile means all machine evidence is `OBSERVE_ONLY`. Open-set rejection, disagreement, ambiguity, geometry/domain failures, or missing policy thresholds block machine admission. Explicit human confirmation yields `HUMAN_ASSERTED` without changing Given/vector/raster history. Machine eligibility requires an approved profile, in-domain condition, open-set acceptance, validated score/margin thresholds, and vector/raster agreement.

### reason codes

Implemented codes include `NO_APPROVED_VALIDATION_PROFILE`, `OUT_OF_VOCABULARY`, `OPEN_SET_UNCERTAIN`, `RASTER_AMBIGUOUS`, `VECTOR_AMBIGUOUS`, `VECTOR_RASTER_DISAGREEMENT`, `PDF_VISUAL_DISAGREEMENT`, `TYPOGRAPHIC_FEATURES_MISSING`, `MULTI_CHAR_GLYPH`, `NO_VISIBLE_GLYPH`, and policy fallback codes.

## UI CHANGES

The existing aside now shows Measurement Validity, model/profile versions, approval, open-set state, admission/reasons, admitted Char, closed-set candidate separately from rejected output, and inspectable typographic-relative evidence. `Comparison` is relabelled `Evidence agreement`; it is not presented as correctness.

## API / PERSISTENCE CHANGES

Jobs persist complete version and hash provenance. Glyphs persist typographic evidence, open-set assessment, measurement quality, validation provenance, and a typed admission decision while preserving existing evidence. APIs return admission envelopes, validation-profile status, validation samples, and independent reviewer adjudications.

## CACHE INVALIDATION

Schema/recognizer job identity changed. Raster caches include artifact digest, mask, typographic vector, and mask. Vector caches include model/typographic version and strong font-definition identity.

## PERFORMANCE RESULTS

The page result records render, Raster preprocessing, Vector extraction/inference, Raster inference/open-set, total-page, and DB-persistence timing. A local smoke benchmark (18 glyphs, one DejaVuSans synthetic PDF page, same process) measured: cold total 5.796 s, Raster preprocessing 3.775 s, Vector extraction/inference 1.924 s, Raster inference/open-set 0.087 s; warm total 0.246 s, Raster preprocessing 0.191 s, Vector 0.046 s, Raster inference/open-set 0.0007 s. Process peak RSS was 656,740 KiB. These are development-machine smoke measurements, not corpus-wide production claims. Existing pixel budget, deferred Raster batching, bounded runtime caches, page chunking, cancellation, and ten-page document checkpoints remain. Extraction orchestration and DB persistence still require aggregate reporting across the real corpus.

## TESTS ADDED

Admission tests cover unapproved blocking, approved-policy eligibility, human assertion, and frontend fail-closed access. Existing Python regressions were migrated to schema 6 and verify evidence separation, Given independence, nonfatal model/OpenCV failure, model provenance, open-set envelope, typographic persistence, strong font-definition collision resistance, actual fusion-feature flow, and default observation-only behavior. Result: 10/10 Python tests pass. Node package test runners are unavailable in the current checkout; direct Node admission assertions pass.

## KNOWN LIMITATIONS

- No adjudicated natural-PDF corpus or measured real-document quality.
- V2 artifacts are a short synthetic bootstrap export, not a promoted production model.
- Type3 CharProc canonical rendering and broad fixture coverage remain incomplete.
- Raw encoded PDF code bytes remain unavailable through current texttrace extraction.
- Calibration, selective-risk curve, and corpus-wide font/performance coverage remain unmeasured.
- A persistent inference service was not substituted for process isolation without benchmarks.

## WHAT REMAINS OBSERVATIONAL

Given mapping, raster/vector predictions, model scores, candidates, open-set assessments, morphology, typographic metrics, comparisons, and unavailable/ambiguous/unknown states remain evidence—not truth.

## WHAT IS NOW ELIGIBLE FOR LAYER 2

Only `HUMAN_ASSERTED` evidence is currently admitted. The dedicated accessor also supports future `ELIGIBLE_WITH_PROVENANCE` decisions after explicit profile approval.

## WHAT IS STILL BLOCKED FROM LAYER 2

Every machine prediction under the current unapproved profile, every raw `predictedChar`, open-set rejection/uncertainty, multi-character glyph, no-visible glyph, unresolved disagreement, unsupported font condition, and unvalidated domain remains blocked.

## PROCEDURAL FUNCTIONALITY WORLDLINE

1. A user deliberately starts document or page analysis; no auto-start occurs.
2. The worker resumes saved checkpoints, obtains the original PDF, and requests bounded page extraction.
3. PyMuPDF emits independent PDF-source observations: Unicode extraction, glyph ID, bbox, font resource, and mapping provenance. Missing raw bytes remain missing.
4. Strong font definition identity is resolved from embedded-program hash, xref, and GID; fallback identity is labelled weak.
5. The Vector provider extracts an embedded outline and em-space metrics or returns a precise unavailable state.
6. The page renderer creates one bounded grayscale page raster and crops each visible glyph instance.
7. OpenCV isolates morphology, preserves pre-normalization geometry, and creates the normalized shape specimen.
8. Raster and Vector fusion models independently consume shape plus masked typographic-relative features. Neither receives Given Char, neighbour text, words, or semantics.
9. Each channel emits a closed-set distribution and independent knownness/open-set assessment. Rejection nulls ordinary predicted Char while retaining the nearest candidate for audit.
10. The evidence envelope computes visibility, sequence, measurement-quality, and cross-channel/PDF agreement observations without majority voting.
11. The validation profile is attached by exact version and hashes. The central admission policy evaluates the envelope; the current unapproved profile forces machine evidence to `OBSERVE_ONLY`.
12. Evidence is chunked into Mongo, visual stages remain separately lazy, and all-document work checkpoints every ten pages.
13. Reloading hydrates only bounded page windows, reapplies independent human confirmations, and recomputes admission without rewriting historical machine evidence.
14. The UI presents Given, Vector, Raster, Human, open-set, typographic validity, profile status, agreement, and admission separately.
15. Downstream code must call `getLayer1Admission`/`getAdmittedChar`; raw prediction is never the canonical character contract.
