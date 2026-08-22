import React, { useMemo, useState } from "react";

const jsonValue = (input) => {
  try {
    const serialized = JSON.stringify(input, null, 2);
    return serialized === undefined ? String(input) : serialized;
  } catch {
    return String(input);
  }
};

const printableString = (input) => String(input).replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => {
  const namedEscape = {
    "\b": "\\b",
    "\t": "\\t",
    "\n": "\\n",
    "\f": "\\f",
    "\r": "\\r",
  }[character];
  if (namedEscape) return namedEscape;
  return `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
});

const formatRawPdfValue = (input) => (
  input == null || input === "" ? "—" : printableString(input)
);

export const formatForensicValue = (input) => {
  if (input == null || input === "") return "—";
  if (typeof input === "number") return Number.isInteger(input) ? String(input) : input.toFixed(3);
  if (typeof input === "boolean") return input ? "yes" : "no";
  if (Array.isArray(input)) {
    if (!input.length) return "[]";
    return input.some((entry) => entry && typeof entry === "object")
      ? jsonValue(input)
      : input.map((entry) => (
        typeof entry === "number"
          ? (Number.isInteger(entry) ? String(entry) : Number(entry).toFixed(2))
          : printableString(entry)
      )).join(", ");
  }
  if (typeof input === "object") return jsonValue(input);
  // Raw PDF literal strings and TJ arrays may legally contain C0/C1 bytes.
  // Rendering those bytes directly makes them invisible or lets them affect
  // layout, so expose them without altering the underlying exported JSON.
  return printableString(input);
};

const EvidenceTable = ({ columns, rows, limit = 400, empty = "No evidence available." }) => {
  if (!rows?.length) return <div className="pdf_forensic_empty">{empty}</div>;
  const visible = rows.slice(0, limit);
  return <div className="pdf_forensic_table_scroll">
    <table className="pdf_forensic_table">
      <thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
      <tbody>{visible.map((row, index) => <tr key={row.id || `${index}-${row.characterIndex ?? row.operatorIndex ?? "row"}`}>
        {columns.map(([key, , formatter]) => {
          const cellValue = typeof key === "function" ? key(row) : row[key];
          return <td key={key}>{formatter ? formatter(cellValue) : formatForensicValue(cellValue)}</td>;
        })}
      </tr>)}</tbody>
    </table>
    {rows.length > limit && <div className="pdf_forensic_truncated">Showing {limit} of {rows.length}. Export JSON for the complete evidence.</div>}
  </div>;
};

const Section = ({ id, title, children, open = false }) => <details className="pdf_forensic_section" open={open}>
  <summary><span>{id}</span>{title}</summary>
  <div className="pdf_forensic_section_body">{children}</div>
</details>;

const TextEvidence = ({ label, text }) => <div className="pdf_forensic_text_block">
  <strong>{label}</strong>
  <pre>{text || "No text evidence available."}</pre>
</div>;

export default function PDFForensicPanel({ report, busy, error, onRetry }) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => report ? JSON.stringify(report, null, 2) : "", [report]);
  const copy = async () => {
    if (!json) return;
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const download = () => {
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pdf-forensics-page-${report.page}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (busy) return <div className="pdf_forensic_state"><span className="pdf_forensic_spinner" />Collecting independent PDF evidence…</div>;
  if (error) return <div className="pdf_forensic_state pdf_forensic_state--error"><strong>Forensic analysis unavailable</strong><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div>;
  if (!report) return <div className="pdf_forensic_state">Open a saved PDF page to collect forensic evidence.</div>;

  const { summary } = report;
  return <div className="pdf_forensic_report">
    <div className="pdf_forensic_notice">
      <i className="bx bx-shield-quarter" aria-hidden="true" />
      <span><strong>Evidence-only analysis.</strong> The PDF and its raw text are not modified. Unknown values remain unresolved.</span>
      <div className="pdf_forensic_actions">
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy JSON"}</button>
        <button type="button" onClick={download}>Export JSON</button>
        <button type="button" onClick={onRetry}>Re-analyze</button>
      </div>
    </div>
    <div className="pdf_forensic_metrics">
      <span><strong>{summary.nativeCharacters}</strong> characters</span>
      <span><strong>{summary.glyphInstances}</strong> glyphs</span>
      <span><strong>{summary.nativeFonts}</strong> fonts</span>
      <span><strong>{summary.whitespaceCandidates}</strong> spaces/gaps</span>
      <span className={summary.discrepancies ? "pdf_forensic_metric--warning" : ""}><strong>{summary.discrepancies}</strong> discrepancies</span>
    </div>

    <Section id="A" title="PDF structure" open>
      <EvidenceTable rows={report.pdfStructure.fonts} columns={[
        ["resourceName", "RESOURCE"], ["baseFont", "FONT"], ["subtype", "SUBTYPE"], ["encoding", "ENCODING"],
        ["embedded", "EMBEDDED"], ["subset", "SUBSET"], [(row) => row.toUnicode?.value, "TO UNICODE"], ["xref", "XREF"],
      ]} />
      <h4>Content-stream text operators</h4>
      <EvidenceTable rows={report.pdfStructure.contentOperators} limit={250} columns={[
        ["operatorIndex", "#"], ["streamXref", "STREAM"], ["textObject", "TEXT OBJECT"], ["operator", "OPERATOR"],
        ["operands", "RAW OPERANDS"], [(row) => row.rawPdfString ?? row.rawPdfArray, "RAW STRING / ARRAY", formatRawPdfValue],
      ]} />
      <h4>PDF.js operator evidence</h4>
      <EvidenceTable rows={report.pdfStructure.pdfJsOperators} limit={250} columns={[
        ["operatorIndex", "#"], ["textObject", "TEXT OBJECT"], ["operator", "OPERATOR"], ["operands", "OPERANDS"],
      ]} />
      {!!report.pdfStructure.limitations.length && <ul className="pdf_forensic_limitations">{report.pdfStructure.limitations.map((item) => <li key={item}>{item}</li>)}</ul>}
    </Section>

    <Section id="B" title="Raw Character Stream" open>
      <TextEvidence label="Native PDF-derived sequence" text={report.rawCharacterStream.text} />
      <EvidenceTable rows={report.rawCharacterStream.characters} columns={[
        ["characterIndex", "#"], ["unicode", "CHAR"], ["unicodeCodepoint", "UNICODE"], ["rawCode", "RAW CODE"],
        ["font", "FONT"], ["lineId", "LINE"], ["bbox", "BBOX"], ["origin", "ORIGIN"], ["explicitInPdf", "EXPLICIT"], ["confidence", "CONFIDENCE"],
      ]} />
    </Section>

    <Section id="C" title="Glyph Stream">
      <EvidenceTable rows={report.glyphStream} columns={[
        ["glyphIndex", "#"], ["correspondingPdfCharacter", "CHAR"], ["glyphId", "GLYPH ID"], ["glyphName", "GLYPH NAME"],
        ["font", "FONT"], ["fontSize", "SIZE"], ["bbox", "BBOX"], ["quality", "QUALITY"], ["confidence", "CONFIDENCE"],
      ]} />
    </Section>

    <Section id="D" title="Geometry Stream">
      <EvidenceTable rows={report.geometryStream} columns={[
        [(row) => `${row.leftCharacter} → ${row.rightCharacter}`, "PAIR"], ["previousGlyphEndX", "END X"], ["nextGlyphStartX", "START X"],
        ["actualGap", "GAP"], ["expectedAdvance", "EXPECTED"], ["normalizedGap", "NORMALIZED"], ["baselineDifference", "BASELINE Δ"],
        ["fontChange", "FONT Δ"], ["structuralBoundary", "STRUCTURAL"],
      ]} />
    </Section>

    <Section id="E" title="Whitespace Analysis" open>
      <EvidenceTable rows={report.whitespaceAnalysis} columns={[
        [(row) => `${row.leftCharacter ?? "∅"} · ${row.rightCharacter ?? "∅"}`, "BOUNDARY"], ["classification", "CLASSIFICATION"],
        ["explicitSpaceCharacter", "EXPLICIT U+SPACE"], ["geometricGap", "GAP"], ["expectedAdvanceGap", "EXPECTED"],
        ["structuralBoundary", "STRUCTURAL"], ["confidence", "CONFIDENCE"], ["reason", "PROVENANCE"],
      ]} />
    </Section>

    <Section id="F" title="Case Analysis">
      <EvidenceTable rows={report.caseAnalysis} columns={[["observedCharacter", "OBSERVED"], ["visualCandidate", "VISUAL"], ["confidence", "CONFIDENCE"], ["reason", "REASON"]]} empty="No case disagreement is currently proven." />
    </Section>

    <Section id="G" title="Visual Analysis">
      <p>{report.visualAnalysis.note}</p>
      <p><strong>Renderer:</strong> {report.visualAnalysis.renderer} · <strong>Automated glyph classification:</strong> {report.visualAnalysis.automatedGlyphClassification}</p>
    </Section>

    <Section id="H" title="OCR Comparison">
      <TextEvidence label={report.ocrComparison.available ? "Independent persisted OCR witness" : "OCR witness unavailable"} text={report.ocrComparison.text} />
    </Section>

    <Section id="I" title="Linguistic Analysis">
      <p><strong>{report.linguisticAnalysis.status}</strong> — {report.linguisticAnalysis.note}</p>
    </Section>

    <Section id="J" title="Discrepancies" open>
      <EvidenceTable rows={report.discrepancies} columns={[
        ["type", "CONFLICT"], ["severity", "SEVERITY"], ["confidence", "CONFIDENCE"], ["characterIndex", "CHAR #"], ["reason", "REASON"],
      ]} empty="No disagreement was detected between the available evidence layers." />
    </Section>

    <Section id="K" title="Canonical Reconstruction" open>
      <div className="pdf_forensic_canonical_meta">
        <span><strong>Source</strong> {report.canonicalReconstruction.source}</span>
        <span><strong>Confidence</strong> {Math.round(report.canonicalReconstruction.confidence * 100)}% · {report.canonicalReconstruction.confidenceLabel}</span>
        <span><strong>Transformations</strong> {report.canonicalReconstruction.transformations.length}</span>
      </div>
      <TextEvidence label="Conservative canonical candidate" text={report.canonicalReconstruction.text} />
      <p>{report.canonicalReconstruction.note}</p>
    </Section>

    <Section id="Observed" title="PDF.js Observed Text Stream">
      <TextEvidence label="getTextContent() output" text={report.observedTextStream.text} />
      <EvidenceTable rows={report.observedTextStream.items} columns={[
        ["itemIndex", "#"], ["text", "TEXT"], ["fontName", "FONT"], ["transform", "TRANSFORM"], ["width", "WIDTH"], ["height", "HEIGHT"], ["hasEOL", "EOL"],
      ]} />
    </Section>
  </div>;
}
