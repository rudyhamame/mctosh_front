# RabbitHole Layer 1 Milestone — Neural GLYPH → CHAR

## Status

Layer 1 now uses a genuine learned classifier for character identity. OpenCV remains the raster morphology and preprocessing instrument, while Dice, IoU, and `cv2.matchShapes` are retained only as explicitly marked debug evidence. PDF Given Char, vector prediction, raster prediction, and human confirmation remain separate evidence channels. No majority vote, language context, dictionary, semantic inference, or automatic PDF correction is performed.

The implementation is operational and versioned. Its measured limitations are documented below; no character-specific rule, score boost, or `S` override was introduced.

## Files created

- `back/pdf-structure/glyph_neural_model.py`
- `back/pdf-structure/train_glyph_classifier.py`
- `back/pdf-structure/neural_glyph_recognizer.py`
- `back/pdf-structure/benchmark_glyph_classifier.py`
- `back/pdf-structure/evaluate_exported_glyph_classifier.py`
- `back/pdf-structure/models/rabbit_glyph_cnn_v1.torchscript.pt`
- `back/pdf-structure/models/rabbit_glyph_cnn_v1.metadata.json`
- `back/pdf-structure/models/rabbit_glyph_cnn_v1.report.json`
- `back/models/GlyphCharTrainingSample.js`
- `back/models/GlyphCharVisualStage.js`

## Files modified

- `back/pdf-structure/opencv_glyph_evidence.py`
- `back/pdf-structure/vector_glyph_evidence.py`
- `back/pdf-structure/glyph_char_analysis.py`
- `back/pdf-structure/main.py`
- `back/pdf-structure/requirements.txt`
- `back/helpers/pdfStructureService.js`
- `back/models/GlyphCharAnalysisJob.js`
- `back/routes/GlyphCharAnalysisAPI.js`
- `back/services/GlyphCharAnalysisWorker.js`
- `back/test/glyphCharAnalysis.integration.test.js`
- `back/pdf-structure/tests/test_glyph_visual_evidence.py`
- `front/src/PDF/glyphChar/visualGlyphRecognizer.js`
- `front/src/PDF/glyphChar/GlyphCharAside.jsx`
- `front/src/PDF/glyphChar/useGlyphCharAnalysis.js`
- `front/src/PDF/glyphChar/glyphChar.css`
- `front/md/layer1.md`

## Old raster recognizer removed/demoted

The old identity path was:

```text
normalized pixels → Dice / IoU / matchShapes → nearest reference → character
```

That path no longer controls Raster Predicted Char. Its output is stored under `morphologicalSimilarity` with `debugOnly: true` and labels such as Template Similarity Score, Dice, IoU, and Contour Similarity. The browser-only template recognizer was also disabled; an unsaved PDF can retain local visual evidence but reports neural recognition as unavailable instead of silently falling back to shape matching.

## New raster model

- Model name: `rabbit-glyph-cnn`
- Model version: `v1`
- Runtime: local PyTorch TorchScript, with no internet dependency
- Artifact size: approximately 2.03 MB
- Prediction source: `BASE_MODEL`
- Output: top-5 class distribution, top-1/top-2 margin, normalized entropy, status, and full model provenance

The output status is one of `predicted`, `ambiguous`, `unpredictable`, or `unavailable`. Ambiguity uses top-1 probability, top-1/top-2 margin, and normalized entropy—not template similarity.

## Model architecture

```text
1×64×64 grayscale input
→ Conv 16 + BatchNorm + GELU + MaxPool
→ Conv 32 + BatchNorm + GELU + MaxPool
→ Conv 64 + BatchNorm + GELU + MaxPool
→ Conv 96 + BatchNorm + GELU
→ Adaptive average pool 4×4
→ Linear 1536→256 + GELU + Dropout
→ Linear 256→93 classes
```

Training uses AdamW, cosine learning-rate decay, label smoothing, deterministic seeds, and validation-selected checkpoints.

## Model input dimensions

OpenCV stores a proportional 96×96 normalized evidence mask. The model adapter deterministically resizes this to `1×64×64`, matching the exported model contract. Foreground is white and background is black.

## Character vocabulary

There are 93 case-sensitive classes:

```text
A-Z
a-z
0-9
.,:;!?()[]{}+-=*/%$#@&_\|'"`~<>
```

The vocabulary is versioned as `latin-print-v1` and can be expanded in a future model version without silently changing old results.

## Training data generation

Training data is generated independently from installed font programs with Pillow and FontTools. PDF Given Char and `/ToUnicode` are never training inputs. A font must cover at least 90% of the current vocabulary to be admitted.

Whole font families are shuffled with a fixed seed and split before rendering. No family appears in more than one of train, validation, or test. Each training font contributes a clean canonical specimen and conservative augmented specimens.

## Training fonts

- Training: 40 families, 74 font files
- Validation: 9 families, 13 font files
- Test: 11 families, 19 font files

The training set includes serif, sans-serif, mono, condensed, narrow, caps, slanted, regular, and bold-capable families. The complete reproducible family/file lists are stored in `rabbit_glyph_cnn_v1.report.json`.

## Held-out fonts

The test families are:

```text
Latin Modern Mono Light Cond
Latin Modern Roman Caps
Z003
Scheherazade
Latin Modern Roman Unslanted
DejaVu Sans Condensed
Latin Modern Mono Prop Light
Liberation Sans
DejaVu Serif
Latin Modern Roman Demi
Electron
```

None of these families is in the training or validation split.

## Data augmentation

Conservative training variation includes font size, horizontal/vertical scale, subpixel position, small rotation, antialiasing, blur, contrast, minor Gaussian noise, occasional erosion/dilation, and both dark-on-light and light-on-dark polarity. Transformations are deliberately bounded to avoid changing character identity. Clean specimens are retained so augmentation artifacts cannot become the only learned signal.

## Sample counts

- Training samples: 13,764
- Validation samples: 1,209
- Test samples: 1,767

Human corrections are stored in the separate `human-correction` provenance split and are not included in these reported metrics.

## OpenCV preprocessing pipeline

```text
exact PyMuPDF glyph bbox
→ high-resolution grayscale crop
→ border-pixel background estimate
→ border-distance Otsu candidate
→ polarity-aware Gaussian/Otsu candidate
→ polarity-aware adaptive-threshold candidate
→ foreground-preservation quality selection
→ morphology measurements and previews
→ tight proportional normalization
→ neural classifier
```

Persisted morphology includes contours, counters, connected components, aspect ratio, foreground percentage, edge percentage, ink bounds, raw dimensions, threshold method/value, background estimate, and polarity convention. Raw, blurred, thresholded, tight, normalized, and contour-preview stages remain inspectable even if neural inference is unavailable.

No destructive opening or erosion is applied to the classifier mask. Erosion/dilation exists only as bounded synthetic training augmentation.

## Normalization pipeline

```text
foreground detection
→ tight ink bounds
→ preserve aspect ratio
→ scale longest dimension into an 80-pixel analysis area
→ center with 8-pixel padding in a 96×96 canvas
→ deterministic white-on-black mask
```

X and Y are never stretched independently. Narrow glyphs remain narrow and wide glyphs remain wide.

## Accuracy

Synthetic held-out-family test:

- Top-1 accuracy: **91.45%**
- Top-3 accuracy: **99.15%**
- Ambiguous rate: **7.07%**
- Unpredictable rate: **0.51%**

Validation-family set:

- Top-1 accuracy: **89.58%**
- Top-3 accuracy: **92.31%**
- Ambiguous rate: **5.38%**
- Unpredictable rate: **1.90%**

Real-PDF held-out-font benchmark:

- Samples: **21,196**
- Point sizes: 6, 8, 10, 12, 18, and 36 pt
- Render scales: 2× and 4×
- Top-1 accuracy: **82.37%**
- Top-3 accuracy: **95.69%**
- Ambiguous rate: **16.83%**
- Unpredictable rate: **4.93%**
- Model-unavailable rate: **0.00%**

The PDF benchmark is intentionally reported separately because low-resolution PDF rasterization is materially harder than clean synthetic specimens.

## Most common confusions

On the synthetic held-out-family test, the leading errors are:

```text
V → v   7
Z → z   7
S → s   6
X → x   6
w → W   6
x → X   5
z → Z   5
C → c   4
c → C   4
o → O   4
```

On the real-PDF benchmark, the leading errors are predominantly scale-normalized case pairs: `V/v`, `W/w`, `O/o`, `S/s`, `C/c`, `X/x`, and `Z/z`. Other notable groups include `0/o`, `I/l/1/|`, and punctuation such as `~/-`.

The full 93×93 confusion matrices and per-character precision/recall/support values are persisted in the model report.

## Probability calibration

Temperature scaling was fitted on validation logits only. The selected temperature is `1.0750000477`, and metadata is versioned as `temperature-scaling-v1`.

Validation negative log likelihood improved from **0.6648** to **0.6574**. Validation expected calibration error was **2.31%** before and **3.75%** after temperature scaling; held-out test ECE was **4.66%** after scaling. This mixed calibration result is reported rather than hidden. The UI exposes the model provenance and distribution separation, and never presents OpenCV template similarity as confidence.

## S regression test result

The automated regression creates uppercase `S` specimens through real PDFs and PyMuPDF rasterization. Three held-out font families/styles are tested at 36 pt and 4×:

```text
Latin Modern Mono Light Cond Regular
Latin Modern Roman Caps Oblique
Latin Modern Roman Unslanted Regular
```

All three produce top-1 `S` with a top-1/top-2 margin greater than 0.20. The test changes no thresholds and contains no `S` rule.

The broader PDF benchmark contains 228 uppercase `S` conditions across all held-out files, sizes, and scales; 70 have top-1 `S`. Many failures are `S → s`, especially when tight scale normalization removes the only size distinction between geometrically equivalent uppercase/lowercase outlines. This is a known model/input limitation, not patched with a forbidden override. The exact original screenshot specimen was not available as a committed fixture.

## Vector recognizer changes

Vector morphology remains derived from the actual embedded font program and glyph ID through FontTools. The outline is normalized and canonically rasterized, then passed to the same trained neural classifier. Thus:

```text
embedded font → actual glyph outline → vector morphology → canonical mask → neural prediction
```

The tiny reference-font bank remains only as `legacy-vector-mask-overlap` debug similarity. Given Char never enters vector inference. Vector and raster predictions remain separate because one originates from the reusable embedded glyph definition and the other from actual page pixels.

## Human confirmation architecture

The UI now says Human Confirmation and Confirm Character—not Train OpenCV. A confirmation stores:

- explicit confirmed character
- normalized-mask fingerprint
- document/job/page/glyph provenance
- embedded font name and glyph ID
- reusable definition cache key
- `labelSource: explicit-human-confirmation`
- `datasetSplit: human-correction`

Identical font-definition/glyph-ID instances display the same Human Confirmed Char as a fourth evidence channel. The confirmation does not overwrite Given, Vector, or Raster values, does not synchronously retrain the model, and does not enter evaluation. `/ToUnicode` is never an automatic label.

## Cache invalidation

Raster cache identity is:

```text
raster:<model-version>:<preprocessing-version>:<normalized-fingerprint>
```

Vector cache identity likewise includes model and preprocessing versions. Persisted jobs are queried by schema and recognizer version, so schema-v4 shape-matching results cannot hydrate into schema-v5 neural UI fields.

## Model and schema versions

- Model: `rabbit-glyph-cnn` / `v1`
- Training dataset: `synthetic-installed-fonts-v1`
- Vocabulary: `latin-print-v1`
- Preprocessing: `opencv-proportional-polarity-v2`
- Calibration: `temperature-scaling-v1`
- Recognizer: `glyph-neural-rabbit-cnn-v1-preprocess-v2`
- Persisted schema: `5`

## Performance safeguards

- TorchScript model is lazily loaded once per Python analysis process.
- Raster masks are inferred in page batches rather than one model call per glyph.
- Byte-identical masks are deduplicated before inference.
- Predictions use a bounded 8,192-entry LRU keyed by compact SHA-256 mask digests.
- Batch-local results cannot be evicted while their response is being assembled.
- Reusable vector definitions are cached by embedded font hash and glyph ID.
- Node persists glyphs in bounded chunks and hydrates only small page windows.
- All-document analysis checkpoints every 10 pages and resumes from MongoDB.
- Jobs remain cancellable and the frontend caps hydrated glyphs.
- Neural initialization/inference failure returns `unavailable` while preserving OpenCV morphology and PDF rendering.

## Known limitations

1. A tightly cropped, proportionally normalized isolated glyph can be mathematically insufficient to distinguish case when a font uses the same scaled outline for both cases. This affects `S/s`, `V/v`, `W/w`, `O/o`, `C/c`, `X/x`, and `Z/z` in some held-out fonts.
2. Six-point text at 2× rasterization is substantially harder than larger or higher-resolution text; the per-condition metrics are preserved in the JSON report.
3. The current vocabulary is Latin print plus common punctuation. Other scripts and broader mathematical symbols require a new vocabulary/model version.
4. Human-confirmed samples are collected but no deliberate offline fine-tuning command consumes them yet. They never alter base-model weights invisibly.
5. TorchScript emits a PyTorch deprecation warning in the installed runtime; migration to `torch.export` is a future packaging improvement, not an inference correctness failure.
6. Calibration improves validation NLL but not ECE on every held-out distribution. Distribution separation and explicit ambiguous/unpredictable states remain mandatory safeguards.
7. Unsaved browser-local PDFs do not run a weaker template fallback. Neural recognition is shown as unavailable until the PDF is saved and analyzed by the local service.

## Reproducibility

```bash
cd /media/rudy/PLUGIN/MCTOSH/back/pdf-structure

# Train, validate, calibrate, and export.
.venv/bin/python train_glyph_classifier.py \
  --epochs 6 --batch-size 128 --max-families 60 --train-variants 2

# Refresh held-out metrics and per-character precision/recall.
.venv/bin/python evaluate_exported_glyph_classifier.py

# Run the real-PDF font/size/render-scale benchmark.
.venv/bin/python benchmark_glyph_classifier.py --max-font-files 19

# Run neural/evidence regressions.
.venv/bin/python -m unittest -v tests.test_glyph_visual_evidence
```

The machine-readable model card, complete font splits, epoch history, confusion matrices, per-character metrics, PDF-condition metrics, and every `S` benchmark specimen are in `back/pdf-structure/models/rabbit_glyph_cnn_v1.report.json`.
