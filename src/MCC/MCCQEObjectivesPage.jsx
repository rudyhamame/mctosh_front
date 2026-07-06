import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import objectivesEn from "./mccqeObjectivesData.json";
import objectivesAr from "./mccqeObjectivesArabicData.json";
import { apiUrl } from "../config/api";
import { LongPressSelectable } from "../utils/longPressSelect";
import "./mccqeObjectivesPage.css";

const VIEW_MODES = {
  EN: "en",
  AR: "ar",
  COMPARE: "compare",
};

const TRANSLATION_CACHE_KEY = "mccqe_objectives_ar_cache_v1";
const COMPARISON_CACHE_KEY = "mccqe_objectives_ar_sentence_pairs_v1";

const normalize = (value) => String(value || "").toLowerCase().trim();

const stripHtml = (html) =>
  String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const arabicLettersRatio = (value) => {
  const text = stripHtml(value);
  const letters = (text.match(/[A-Za-z\u0600-\u06FF]/g) || []).length;
  if (!letters) return 0;
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabic / letters;
};

const hasUsableArabicContent = (html) => arabicLettersRatio(html) >= 0.35;

const cleanAiHtml = (value) =>
  String(value || "")
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

const readCache = (key) => {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeCache = (key, value) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const englishById = new Map(objectivesEn.map((item) => [String(item.id), item]));
const arabicById = new Map(objectivesAr.map((item) => [String(item.id), item]));

const groupedOptions = Array.from(
  new Map(
    objectivesEn
      .map((item) => ({
        id: String(item.group?.id || "").trim(),
        title: String(item.group?.title || "").trim(),
      }))
      .filter((group) => group.id || group.title)
      .map((group) => [`${group.id}::${group.title}`, group])
  ).values()
).sort((a, b) => a.title.localeCompare(b.title));

const htmlToStructuredText = (html) =>
  String(html || "")
    .replace(/<\/(h1|h2|h3|h4|h5|h6|p|li|div|tr|section|article|ol|ul)>/gi, "$&\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const splitIntoSentenceUnits = (html) => {
  const text = htmlToStructuredText(html);
  if (!text) return [];

  const paragraphLikeBlocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "sentence" })
    : null;

  return paragraphLikeBlocks.flatMap((block) => {
    const singleLineBlock = block.replace(/\n+/g, " ").trim();
    if (!singleLineBlock) return [];

    if (segmenter) {
      const segments = Array.from(segmenter.segment(singleLineBlock), (segment) => segment.segment.trim()).filter(Boolean);
      return segments.length ? segments : [singleLineBlock];
    }

    const pieces = singleLineBlock.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    return (pieces || [singleLineBlock]).map((piece) => piece.trim()).filter(Boolean);
  });
};

const streamArabicTranslation = async ({ title, content }) => {
  const res = await fetch(apiUrl("/api/ai/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "groq",
      messages: [
        {
          role: "system",
          content:
            "Translate the provided medical objective HTML into Arabic. " +
            "Preserve all HTML tags, element order, links, lists, and headings. " +
            "Translate visible text only. Keep medical meaning precise. " +
            "Return only translated HTML with no markdown fences or commentary.",
        },
        {
          role: "user",
          content:
            `Title: ${String(title || "").trim()}\n\n` +
            `HTML to translate:\n${String(content || "").trim()}`,
        },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Translation request failed.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let translated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.delta) translated += parsed.delta;
      } catch (err) {
        if (err instanceof Error) throw err;
      }
    }
  }

  return cleanAiHtml(translated);
};

const streamArabicSentencePairs = async ({ title, sentences }) => {
  const res = await fetch(apiUrl("/api/ai/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "groq",
      messages: [
        {
          role: "system",
          content:
            "Translate each English medical sentence into Arabic. " +
            "Return only a valid JSON array of Arabic strings, in exactly the same order and with exactly the same number of items. " +
            "Do not omit, merge, split, summarize, or comment.",
        },
        {
          role: "user",
          content:
            `Objective title: ${String(title || "").trim()}\n\n` +
            `Sentences JSON:\n${JSON.stringify(sentences)}`,
        },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Sentence translation request failed.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let translated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      const parsed = JSON.parse(payload);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.delta) translated += parsed.delta;
    }
  }

  const cleaned = cleanAiHtml(translated);
  const match = cleaned.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(match ? match[0] : cleaned);
  if (!Array.isArray(parsed)) throw new Error("Sentence translation response was not an array.");
  return parsed.map((item) => String(item || "").trim());
};

export default function MCCQEObjectivesPage() {
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [viewMode, setViewMode] = useState(VIEW_MODES.EN);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [translatedContentById, setTranslatedContentById] = useState(() => readCache(TRANSLATION_CACHE_KEY));
  const [comparisonPairsById, setComparisonPairsById] = useState(() => readCache(COMPARISON_CACHE_KEY));
  const [translatingIds, setTranslatingIds] = useState({});
  const [comparingIds, setComparingIds] = useState({});
  const [translationErrors, setTranslationErrors] = useState({});
  const [comparisonErrors, setComparisonErrors] = useState({});
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    writeCache(TRANSLATION_CACHE_KEY, translatedContentById);
  }, [translatedContentById]);

  useEffect(() => {
    writeCache(COMPARISON_CACHE_KEY, comparisonPairsById);
  }, [comparisonPairsById]);

  const objectives = useMemo(
    () => objectivesEn.map((en) => ({ id: String(en.id), en, ar: arabicById.get(String(en.id)) || null })),
    []
  );

  const filteredObjectives = useMemo(() => {
    const q = normalize(deferredQuery);

    return objectives.filter(({ en, ar }) => {
      const base = viewMode === VIEW_MODES.AR ? (ar || en) : (en || ar);
      if (!base) return false;

      const matchesGroup =
        selectedGroup === "all" ||
        `${String(base.group?.id || "").trim()}::${String(base.group?.title || "").trim()}` === selectedGroup;
      if (!matchesGroup) return false;
      if (!q) return true;

      const haystack = normalize([
        en?.id,
        en?.title,
        ar?.title,
        en?.role,
        ar?.role,
        en?.language,
        ar?.language,
        en?.version,
        ar?.version,
        en?.group?.id,
        en?.group?.title,
        ar?.group?.id,
        ar?.group?.title,
        stripHtml(en?.content),
        stripHtml(ar?.content),
      ].join(" "));

      return haystack.includes(q);
    });
  }, [deferredQuery, objectives, selectedGroup, viewMode]);

  const ensureArabicContent = async ({ id, en, ar }) => {
    if (!en?.content) return;
    if (hasUsableArabicContent(ar?.content)) return;
    if (translatedContentById[id] || translatingIds[id]) return;

    setTranslatingIds((prev) => ({ ...prev, [id]: true }));
    setTranslationErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const translated = await streamArabicTranslation({
        title: ar?.title || en.title,
        content: en.content,
      });

      setTranslatedContentById((prev) => ({ ...prev, [id]: translated }));
    } catch (err) {
      setTranslationErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Translation failed.",
      }));
    } finally {
      setTranslatingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const ensureSentenceComparison = async ({ id, en, ar }) => {
    if (!en?.content || comparisonPairsById[id] || comparingIds[id]) return;

    const englishSentences = splitIntoSentenceUnits(en.content);
    if (englishSentences.length === 0) return;

    setComparingIds((prev) => ({ ...prev, [id]: true }));
    setComparisonErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const arabicSentences = await streamArabicSentencePairs({
        title: ar?.title || en.title,
        sentences: englishSentences,
      });

      const pairs = englishSentences.map((english, index) => ({
        english,
        arabic: String(arabicSentences[index] || "").trim(),
      }));

      setComparisonPairsById((prev) => ({ ...prev, [id]: pairs }));
    } catch (err) {
      setComparisonErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Sentence comparison translation failed.",
      }));
    } finally {
      setComparingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const toggleExpanded = async (objective) => {
    const id = objective.id;
    const nextExpanded = new Set(expandedIds);
    if (nextExpanded.has(id)) {
      nextExpanded.delete(id);
      setExpandedIds(nextExpanded);
      return;
    }

    nextExpanded.add(id);
    setExpandedIds(nextExpanded);

    if (viewMode === VIEW_MODES.AR) {
      await ensureArabicContent(objective);
    }
    if (viewMode === VIEW_MODES.COMPARE) {
      await ensureSentenceComparison(objective);
    }
  };

  const totalCount = objectivesEn.length;

  return (
    <div id="mccqe_page">
      <header id="mccqe_hero">
        <div id="mccqe_hero_copy">
          <span id="mccqe_eyebrow">MCCQE Objectives</span>
          <h1 id="mccqe_title">Medical Council of Canada Objectives Reader</h1>
          <p id="mccqe_intro">
            Browse the English objectives, open an Arabic reading mode, or compare English and Arabic side by side. Arabic body text is generated per objective and cached locally.
          </p>
        </div>
        <div id="mccqe_stats">
          <div className="mccqe_stat_card">
            <span className="mccqe_stat_value">{totalCount}</span>
            <span className="mccqe_stat_label">English objectives</span>
          </div>
          <div className="mccqe_stat_card">
            <span className="mccqe_stat_value">{objectivesAr.length}</span>
            <span className="mccqe_stat_label">Arabic title records</span>
          </div>
          <div className="mccqe_stat_card">
            <span className="mccqe_stat_value">{filteredObjectives.length}</span>
            <span className="mccqe_stat_label">Visible results</span>
          </div>
        </div>
      </header>

      <div id="mccqe_layout">
        <aside id="mccqe_sidebar">
          <div className="mccqe_sidebar_block">
            <label className="mccqe_field_label" htmlFor="mccqe_view_mode">View Mode</label>
            <div id="mccqe_view_toggle">
              <button type="button" className={`mccqe_view_btn${viewMode === VIEW_MODES.EN ? " mccqe_view_btn--active" : ""}`} onClick={() => setViewMode(VIEW_MODES.EN)}>EN</button>
              <button type="button" className={`mccqe_view_btn${viewMode === VIEW_MODES.AR ? " mccqe_view_btn--active" : ""}`} onClick={() => setViewMode(VIEW_MODES.AR)}>AR</button>
              <button type="button" className={`mccqe_view_btn${viewMode === VIEW_MODES.COMPARE ? " mccqe_view_btn--active" : ""}`} onClick={() => setViewMode(VIEW_MODES.COMPARE)}>EN/AR Comparison</button>
            </div>
          </div>

          <div className="mccqe_sidebar_block">
            <label className="mccqe_field_label" htmlFor="mccqe_search">Search</label>
            <input
              id="mccqe_search"
              className="mccqe_field_input"
              type="search"
              placeholder="Search titles, versions, groups, and content..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="mccqe_sidebar_block">
            <label className="mccqe_field_label" htmlFor="mccqe_group">Group</label>
            <select
              id="mccqe_group"
              className="mccqe_field_input"
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
            >
              <option value="all">All groups</option>
              <option value="::">Ungrouped</option>
              {groupedOptions.map((group) => (
                <option key={`${group.id}::${group.title}`} value={`${group.id}::${group.title}`}>
                  {group.title}{group.id ? ` (${group.id})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="mccqe_sidebar_block">
            <p className="mccqe_sidebar_note">
              Route: <code>/mcc/mccqe/objectives/</code>
            </p>
            <p className="mccqe_sidebar_note">
              Arabic titles come from <code>mcc_arabic_draft.json</code>. Detailed Arabic body text is produced objective-by-objective from the English HTML and stored locally in your browser.
            </p>
          </div>
        </aside>

        <main id="mccqe_results">
          {filteredObjectives.length === 0 ? (
            <div className="mccqe_empty">
              <h2>No objectives found</h2>
              <p>Try a broader search term or reset the filters.</p>
            </div>
          ) : (
            filteredObjectives.map((objective) => {
              const { id, en, ar } = objective;
              const isExpanded = expandedIds.has(id);
              const arabicContent = hasUsableArabicContent(ar?.content) ? ar.content : translatedContentById[id];
              const isTranslating = Boolean(translatingIds[id]);
              const isComparing = Boolean(comparingIds[id]);
              const translationError = translationErrors[id];
              const comparisonError = comparisonErrors[id];
              const comparisonPairs = comparisonPairsById[id] || [];
              const groupTitle = String((en || ar)?.group?.title || "").trim();
              const groupId = String((en || ar)?.group?.id || "").trim();
              const displayTitle =
                viewMode === VIEW_MODES.AR
                  ? (ar?.title || en?.title)
                  : viewMode === VIEW_MODES.COMPARE
                    ? null
                    : (en?.title || ar?.title);

              return (
                <article key={id} id={`mccqe-objective-${id}`} className={`mccqe_objective_card${isExpanded ? " mccqe_objective_card--expanded" : ""}`}>
                  <button
                    type="button"
                    className="mccqe_objective_summary"
                    onClick={() => toggleExpanded(objective)}
                  >
                    <div className="mccqe_objective_meta">
                      <span className="mccqe_objective_id">#{id}</span>
                      <span className="mccqe_objective_role">{en?.role || ar?.role}</span>
                      <span className="mccqe_objective_lang">
                        {viewMode === VIEW_MODES.COMPARE ? "EN + AR" : viewMode.toUpperCase()}
                      </span>
                      <span className="mccqe_objective_version">{en?.version || ar?.version}</span>
                    </div>

                    {viewMode === VIEW_MODES.COMPARE ? (
                      <div className="mccqe_compare_titles">
                        <div className="mccqe_compare_title_block">
                          <span className="mccqe_compare_label">English</span>
                          <h2 className="mccqe_objective_title">{en?.title || "Missing English title"}</h2>
                        </div>
                        <div className="mccqe_compare_title_block mccqe_compare_title_block--arabic">
                          <span className="mccqe_compare_label">Arabic</span>
                          <h2 className="mccqe_objective_title mccqe_objective_title--arabic">{ar?.title || en?.title || "العنوان غير متوفر"}</h2>
                        </div>
                      </div>
                    ) : (
                      <h2 className={`mccqe_objective_title${viewMode === VIEW_MODES.AR ? " mccqe_objective_title--arabic" : ""}`}>
                        {displayTitle}
                      </h2>
                    )}

                    {(groupTitle || groupId) && (
                      <div className="mccqe_objective_group">
                        {groupTitle || "Untitled group"}{groupId ? ` · ${groupId}` : ""}
                      </div>
                    )}

                    <span className="mccqe_expand_hint">{isExpanded ? "Hide content" : "Open content"}</span>
                  </button>

                  {isExpanded && (
                    <div className="mccqe_objective_body">
                      {viewMode === VIEW_MODES.EN && (
                        <LongPressSelectable
                          className="mccqe_objective_content"
                          dir="ltr"
                          dangerouslySetInnerHTML={{ __html: en?.content || "" }}
                        />
                      )}

                      {viewMode === VIEW_MODES.AR && (
                        isTranslating ? (
                          <div className="mccqe_translate_state">Generating Arabic body text…</div>
                        ) : translationError ? (
                          <div className="mccqe_translate_state mccqe_translate_state--error">
                            <p>⚠ {translationError}</p>
                            <button type="button" className="mccqe_retry_btn" onClick={() => ensureArabicContent(objective)}>Retry translation</button>
                          </div>
                        ) : arabicContent ? (
                          <LongPressSelectable
                            className="mccqe_objective_content mccqe_objective_content--arabic"
                            dir="rtl"
                            dangerouslySetInnerHTML={{ __html: arabicContent }}
                          />
                        ) : (
                          <div className="mccqe_translate_state">Arabic content is not available yet.</div>
                        )
                      )}

                      {viewMode === VIEW_MODES.COMPARE && (
                        <div className="mccqe_compare_grid">
                          {isComparing ? (
                            <div className="mccqe_translate_state">Generating sentence-by-sentence Arabic comparison…</div>
                          ) : comparisonError ? (
                            <div className="mccqe_translate_state mccqe_translate_state--error">
                              <p>⚠ {comparisonError}</p>
                              <button type="button" className="mccqe_retry_btn" onClick={() => ensureSentenceComparison(objective)}>Retry comparison</button>
                            </div>
                          ) : comparisonPairs.length > 0 ? (
                            <div className="mccqe_sentence_table">
                              <div className="mccqe_sentence_table_head">English sentence</div>
                              <div className="mccqe_sentence_table_head mccqe_sentence_table_head--arabic">Arabic sentence</div>
                              {comparisonPairs.map((pair, index) => (
                                <React.Fragment key={`${id}-pair-${index}`}>
                                  <div className="mccqe_sentence_cell">{pair.english}</div>
                                  <div className="mccqe_sentence_cell mccqe_sentence_cell--arabic" dir="rtl">{pair.arabic || "—"}</div>
                                </React.Fragment>
                              ))}
                            </div>
                          ) : (
                            <div className="mccqe_translate_state">Sentence comparison is not available yet.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </main>
      </div>
    </div>
  );
}
