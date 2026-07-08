import React from "react";
import "./draftTextViewer.css";

export const cleanMarkdownToPlainText = (text) => String(text || "")
  .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
  .replace(/^\s{0,3}#{1,6}\s*/gm, "")
  .replace(/^\s*>\s?/gm, "")
  .replace(/^\s*[-*+]\s+/gm, "")
  .replace(/^\s*\d+\.\s+/gm, "")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
  .replace(/(`)([^`]+)\1/g, "$2")
  .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
  .replace(/(\*\*|__)(.*?)\1/g, "$2")
  .replace(/(\*|_)(.*?)\1/g, "$2")
  .replace(/^\s*---+\s*$/gm, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const renderTextWithHighlight = (text, highlightRange) => {
  if (!highlightRange) return text;

  const nodes = [];
  let buffer = "";
  let key = 0;

  for (let idx = 0; idx < text.length; idx += 1) {
    const char = text[idx];
    const isHighlighted = idx >= highlightRange.start && idx < highlightRange.end;

    if (isHighlighted) {
      if (buffer) {
        nodes.push(buffer);
        buffer = "";
      }
      nodes.push(
        <span key={`hl-${key++}`} className="draft_text_viewer__highlight">
          {char}
        </span>
      );
      continue;
    }

    buffer += char;
  }

  if (buffer) nodes.push(buffer);
  return nodes.length ? nodes : text;
};

const DraftTextViewer = ({ text, emptyText, className = "", highlightRange = null }) => {
  const cleaned = cleanMarkdownToPlainText(text);
  const paragraphs = cleaned
    ? cleaned.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    : [];

  let globalOffset = 0;

  return (
    <div className={`draft_text_viewer ${className}`.trim()}>
      {paragraphs.length ? paragraphs.map((paragraph, idx) => {
        const lines = paragraph.split(/\n/);
        let lineOffset = 0;
        const paragraphStart = globalOffset;
        const paragraphEnd = paragraphStart + paragraph.length;
        const paragraphHighlight = highlightRange && highlightRange.end > paragraphStart && highlightRange.start < paragraphEnd
          ? {
              start: Math.max(0, highlightRange.start - paragraphStart),
              end: Math.min(paragraph.length, highlightRange.end - paragraphStart),
            }
          : null;

        globalOffset = paragraphEnd + 2;

        return (
          <p key={idx} className="draft_text_viewer__paragraph">
            {lines.map((line, lineIdx) => {
              const lineHighlight = paragraphHighlight && paragraphHighlight.end > lineOffset && paragraphHighlight.start < lineOffset + line.length
                ? {
                    start: Math.max(0, paragraphHighlight.start - lineOffset),
                    end: Math.min(line.length, paragraphHighlight.end - lineOffset),
                  }
                : null;
              const lineNode = renderTextWithHighlight(line, lineHighlight);
              lineOffset += line.length + 1;

              return (
                <React.Fragment key={`${idx}-${lineIdx}`}>
                  {lineNode}
                  {lineIdx < lines.length - 1 ? <br /> : null}
                </React.Fragment>
              );
            })}
          </p>
        );
      }) : <p className="draft_text_viewer__paragraph">{emptyText}</p>}
    </div>
  );
};

export default DraftTextViewer;
