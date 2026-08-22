const TAG_TO_EXPRESSION = {
  laugh: { expression: "amused", durationMs: 950 },
  giggle: { expression: "amused", durationMs: 850 },
  chuckle: { expression: "amused", durationMs: 800 },
  smile: { expression: "reassuring", durationMs: 700 },
  breath: { expression: "attentive", durationMs: 420 },
  sigh: { expression: "relieved", durationMs: 780 },
  gasp: { expression: "alert", durationMs: 620 },
  surprise: { expression: "alert", durationMs: 700 },
  cough: { expression: "concerned", durationMs: 500 },
  sob: { expression: "concerned", durationMs: 900 },
  cry: { expression: "concerned", durationMs: 900 },
};

const TAG_PATTERN = /<([a-z][a-z0-9_-]*)>/gi;

export const stripExpressionTags = (text) => String(text || "").replace(TAG_PATTERN, " ").replace(/\s+/g, " ").trim();

export const buildExpressionTimeline = (text, totalDurationMs) => {
  const rawText = String(text || "");
  const durationMs = Math.max(0, Number(totalDurationMs) || 0);
  if (!rawText || !durationMs) return [];

  const matches = Array.from(rawText.matchAll(TAG_PATTERN));
  if (!matches.length) return [];

  const plainText = stripExpressionTags(rawText);
  const totalPlainChars = Math.max(plainText.length, 1);
  const events = [];

  matches.forEach((match) => {
    const fullMatch = match[0];
    const tagName = String(match[1] || "").toLowerCase();
    const mapping = TAG_TO_EXPRESSION[tagName];
    if (!mapping) return;

    const prefixPlainChars = stripExpressionTags(rawText.slice(0, match.index || 0)).length;
    const startMs = Math.round((prefixPlainChars / totalPlainChars) * durationMs);
    const endMs = Math.min(durationMs, startMs + mapping.durationMs);

    events.push({ time: startMs, expression: mapping.expression });
    events.push({ time: endMs, expression: null });
  });

  return events.sort((a, b) => a.time - b.time);
};
