import React, { useEffect, useMemo, useRef, useState } from "react";

const clampPage = (page, pageCount) => Math.min(pageCount, Math.max(1, Number(page) || 1));

const placeInputCaretFromPointer = (input, clientX) => {
  const styles = window.getComputedStyle(input);
  const canvas = placeInputCaretFromPointer.canvas || (placeInputCaretFromPointer.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) return input.value.length;
  context.font = styles.font;
  const rect = input.getBoundingClientRect();
  const x = Math.max(0, clientX - rect.left - (Number.parseFloat(styles.paddingLeft) || 0) + input.scrollLeft);
  let low = 0;
  let high = input.value.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const width = context.measureText(input.value.slice(0, middle + 1)).width;
    if (width < x) low = middle + 1;
    else high = middle;
  }
  const before = context.measureText(input.value.slice(0, low)).width;
  const after = context.measureText(input.value.slice(0, low + 1)).width;
  return x <= before + (after - before) / 2
    ? low
    : Math.min(low + 1, input.value.length);
};

const SelectionFreeInput = ({ value, onChange, autoFocus = false, placeholder = "", ariaLabel, required = false }) => {
  const inputRef = useRef(null);
  const [caret, setCaret] = useState(value.length);
  const [selection, setSelection] = useState(null);
  const selectionRef = useRef(null);
  const lastTapRef = useRef(null);
  const dragCleanupRef = useRef(null);

  useEffect(() => {
    if (!autoFocus || !inputRef.current) return;
    const input = inputRef.current;
    const end = input.value.length;
    input.focus({ preventScroll: true });
    input.setSelectionRange(end, end);
    setCaret(end);
  }, [autoFocus]);

  useEffect(() => {
    setCaret((current) => Math.min(current, value.length));
    setSelection((current) => current && current.start < value.length
      ? { start: current.start, end: Math.min(current.end, value.length) }
      : null);
  }, [value.length]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const publishSelection = (input, range) => {
    if (!input) return;
    if (range) {
      input.dataset.appSelectionStart = String(range.start);
      input.dataset.appSelectionEnd = String(range.end);
    } else {
      delete input.dataset.appSelectionStart;
      delete input.dataset.appSelectionEnd;
    }
    window.dispatchEvent(new CustomEvent("amctoshs:editable-selection", {
      detail: {
        target: input,
        text: range ? input.value.slice(range.start, range.end) : "",
        start: range?.start ?? 0,
        end: range?.end ?? 0,
        persistent: Boolean(range),
      },
    }));
  };

  const storeSelection = (input, range) => {
    selectionRef.current = range;
    setSelection(range);
    publishSelection(input, range);
  };

  const prepareSelectionForInput = () => {
    const input = inputRef.current;
    const range = selectionRef.current;
    if (!input || !range) return;
    selectionRef.current = null;
    setSelection(null);
    publishSelection(input, null);
    input.setSelectionRange(range.start, range.end, "forward");
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const onBeforeInput = () => prepareSelectionForInput();
    const onVirtualInput = (event) => {
      if (event.detail?.target === input) prepareSelectionForInput();
    };
    input.addEventListener("beforeinput", onBeforeInput, true);
    window.addEventListener("virtual-keyboard:before-input", onVirtualInput);
    return () => {
      input.removeEventListener("beforeinput", onBeforeInput, true);
      window.removeEventListener("virtual-keyboard:before-input", onVirtualInput);
      publishSelection(input, null);
    };
  }, []);

  const syncEditorSelection = () => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      setCaret(end);
      if (!selectionRef.current) setSelection(start < end ? { start, end } : null);
    });
  };

  const applyRange = (start, end) => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const range = start < end ? { start, end } : null;
    // The displayed layer owns the highlight and handles. Keep WebKit's real
    // input selection collapsed so it has no range for its native edit menu.
    input.setSelectionRange(end, end, "none");
    setCaret(end);
    storeSelection(input, range);
  };

  const selectWordAt = (position) => {
    if (!value) return;
    const isWordCharacter = (character) => /[\p{L}\p{N}'_-]/u.test(character || "");
    let start = Math.min(position, value.length - 1);
    if (!isWordCharacter(value[start]) && start > 0 && isWordCharacter(value[start - 1])) start -= 1;
    if (!isWordCharacter(value[start])) {
      applyRange(position, position);
      return;
    }
    let end = start + 1;
    while (start > 0 && isWordCharacter(value[start - 1])) start -= 1;
    while (end < value.length && isWordCharacter(value[end])) end += 1;
    applyRange(start, end);
  };

  const focusAtPointer = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const input = inputRef.current;
    if (!input) return;
    const position = placeInputCaretFromPointer(input, event.clientX);
    const now = Date.now();
    const previous = lastTapRef.current;
    const isDoubleTap = event.detail > 1 || (previous
      && now - previous.time <= 500
      && Math.abs(event.clientX - previous.x) <= 28);
    if (isDoubleTap) {
      lastTapRef.current = null;
      selectWordAt(position);
    } else {
      lastTapRef.current = { time: now, x: event.clientX };
      applyRange(position, position);
    }
  };

  const startHandleDrag = (edge, event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selection) return;
    dragCleanupRef.current?.();
    const pointerId = event.pointerId;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const input = inputRef.current;
      if (!input) return;
      const position = placeInputCaretFromPointer(input, moveEvent.clientX);
      if (edge === "start") applyRange(Math.min(position, selection.end - 1), selection.end);
      else applyRange(selection.start, Math.max(selection.start + 1, position));
    };
    const stop = (endEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
  };

  return (
    <span className="pdf_selection_free_input">
      <input
        ref={inputRef}
        type="text"
        className="pdf_selection_free_input_control"
        value={value}
        onChange={(event) => { onChange(event); syncEditorSelection(); }}
        onKeyUp={syncEditorSelection}
        onSelect={syncEditorSelection}
        placeholder={placeholder}
        aria-label={ariaLabel}
        required={required}
        data-no-predict=""
        onContextMenu={(event) => event.preventDefault()}
      />
      <span
        className={`pdf_selection_free_input_display${value ? "" : " is-placeholder"}`}
        aria-hidden="true"
        onPointerDown={focusAtPointer}
        onContextMenu={(event) => event.preventDefault()}
      >
        {value ? selection ? <>
          <span>{value.slice(0, selection.start)}</span>
          <span className="pdf_selection_free_input_selected">
            <i className="pdf_selection_free_input_handle pdf_selection_free_input_handle--start" onPointerDown={(event) => startHandleDrag("start", event)} />
            {value.slice(selection.start, selection.end)}
            <i className="pdf_selection_free_input_handle pdf_selection_free_input_handle--end" onPointerDown={(event) => startHandleDrag("end", event)} />
          </span>
          <span>{value.slice(selection.end)}</span>
        </> : <><span>{value.slice(0, caret)}</span><i className="pdf_selection_free_input_caret" /><span>{value.slice(caret)}</span></> : placeholder}
      </span>
    </span>
  );
};

const scrollPageNodeIntoPanel = (panel, pageNode) => {
  if (!panel || !pageNode) return false;
  const panelRect = panel.getBoundingClientRect();
  const pageRect = pageNode.getBoundingClientRect();
  const panelCenter = panelRect.top + panelRect.height / 2;
  const pageCenter = pageRect.top + pageRect.height / 2;
  panel.scrollTop += pageCenter - panelCenter;
  return true;
};

const PdfMiniPage = ({ pdfDoc, pageNumber, active, rangeEnd, outlineDraft, onChangeOutlineTitle, onSubmitOutline, onCancelOutline, bookmarked, bookmarkLabel = "", onSelect, onSelectRangePage, onToggleBookmark, onUpdateBookmark, onInsertBlankPage, registerNode, stacked = false }) => {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(active);
  const [failed, setFailed] = useState(false);
  const [bookmarkEditorOpen, setBookmarkEditorOpen] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState(bookmarkLabel);

  const openBookmarkEditor = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (bookmarked) {
      onToggleBookmark(pageNumber);
      setBookmarkEditorOpen(false);
      return;
    }
    onToggleBookmark(pageNumber);
    setBookmarkNote(bookmarkLabel);
    setBookmarkEditorOpen(true);
  };

  const submitBookmarkNote = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const note = bookmarkNote.trim();
    if (!note || onUpdateBookmark?.(pageNumber, note) === false) return;
    setBookmarkEditorOpen(false);
  };

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    registerNode(pageNumber, node);
    const panel = node.closest("#pdf_navigator_panel, #pdf_outline_panel");
    if (!window.IntersectionObserver || !panel) {
      setVisible(true);
      return () => registerNode(pageNumber, null);
    }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { root: panel, rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      registerNode(pageNumber, null);
    };
  }, [pageNumber, registerNode]);

  useEffect(() => {
    if (active) setVisible(true);
  }, [active]);

  useEffect(() => {
    if (!visible || !pdfDoc || !canvasRef.current) return undefined;
    let cancelled = false;
    let renderTask = null;
    setFailed(false);
    void pdfDoc.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(0.22, 112 / Math.max(1, baseViewport.width)) });
      const canvas = canvasRef.current;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable.");
      renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
      });
      return renderTask.promise;
    }).catch((error) => {
      if (!cancelled && error?.name !== "RenderingCancelledException") setFailed(true);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [pdfDoc, pageNumber, visible]);

  return (
    <div
      ref={rootRef}
      data-pdf-mini-page={pageNumber}
      className={`pdf_mini_page${active ? " pdf_mini_page--active" : ""}${rangeEnd ? " pdf_mini_page--range-end" : ""}${stacked ? " pdf_mini_page--stacked" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {!stacked && outlineDraft && outlineDraft.startPage === pageNumber && (
        <form className="pdf_outline_inline_editor" onSubmit={onSubmitOutline}>
          <div className="pdf_outline_inline_editor_heading">
            <span>Outline starts here</span>
            <button type="button" onClick={onCancelOutline} aria-label="Cancel outline section"><i className="bx bx-x" /></button>
          </div>
          <SelectionFreeInput
            value={outlineDraft.title}
            onChange={(event) => onChangeOutlineTitle(event.target.value)}
            placeholder="Section name"
            ariaLabel="Outline section name"
            required
          />
          <small>Click the last page thumbnail to set the section end.</small>
        </form>
      )}
      <button type="button" className="pdf_mini_page_preview" onClick={() => onSelectRangePage ? onSelectRangePage(pageNumber) : onSelect(pageNumber)} title={stacked ? "Open section" : onSelectRangePage ? `Set page ${pageNumber} as the last page` : `Go to page ${pageNumber}`}>
        <canvas ref={canvasRef} aria-label={`Page ${pageNumber} preview`} />
        {failed && <i className="bx bx-error-circle pdf_mini_page_error" aria-hidden="true" />}
        <span>{pageNumber}</span>
      </button>
      {!stacked && bookmarkEditorOpen && (
        <form className="pdf_mini_bookmark_editor" onSubmit={submitBookmarkNote} onClick={(event) => event.stopPropagation()}>
          <input
            type="text"
            value={bookmarkNote}
            onChange={(event) => setBookmarkNote(event.target.value)}
            placeholder="Bookmark note"
            aria-label={`Bookmark note for page ${pageNumber}`}
            autoFocus
          />
          <button type="submit" disabled={!bookmarkNote.trim()} title="Save bookmark note" aria-label={`Save bookmark note for page ${pageNumber}`}><i className="bx bx-check" /></button>
          <button type="button" onClick={() => setBookmarkEditorOpen(false)} title="Cancel bookmark note" aria-label={`Cancel bookmark note for page ${pageNumber}`}><i className="bx bx-x" /></button>
        </form>
      )}
      {!stacked && bookmarked && bookmarkLabel && !bookmarkEditorOpen && (
        <small className="pdf_mini_bookmark_note" title={bookmarkLabel}>{bookmarkLabel}</small>
      )}
      {!stacked && outlineDraft && outlineDraft.endPage === pageNumber && (
        <button
          type="button"
          className="pdf_outline_inline_editor_save pdf_outline_inline_editor_save--at-end"
          onClick={onSubmitOutline}
        >
          <i className="bx bx-check" /> Save section · p. {outlineDraft.endPage}
        </button>
      )}
      {!stacked && <div className="pdf_mini_page_actions">
        <button
          type="button"
          className="pdf_mini_page_action"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onInsertBlankPage(pageNumber);
          }}
          title={`Insert blank page after page ${pageNumber}`}
          aria-label={`Insert blank page after page ${pageNumber}`}
        ><i className="bx bx-file-plus" /></button>
        <button
          type="button"
          className={bookmarked ? "pdf_mini_page_action pdf_mini_page_action--active" : "pdf_mini_page_action"}
          onClick={openBookmarkEditor}
          title={bookmarked ? "Remove bookmark" : "Bookmark page and add note"}
          aria-label={bookmarked ? `Remove bookmark from page ${pageNumber}` : `Bookmark page ${pageNumber} and add note`}
        ><i className="bx bx-bookmark" /></button>
      </div>}
    </div>
  );
};

const normalizeSections = (outlines, pageCount) => {
  const assigned = new Set();
  const sections = [...outlines]
    .map((outline) => ({
      ...outline,
      startPage: clampPage(outline.startPage, pageCount),
      endPage: clampPage(outline.endPage, pageCount),
    }))
    .filter((outline) => outline.title && outline.endPage >= outline.startPage)
    .sort((a, b) => a.startPage - b.startPage || a.endPage - b.endPage)
    .map((outline) => {
      const pages = [];
      for (let page = outline.startPage; page <= outline.endPage; page += 1) {
        if (!assigned.has(page)) {
          assigned.add(page);
          pages.push(page);
        }
      }
      return { ...outline, pages };
    })
    .filter((outline) => outline.pages.length > 0);
  const unsectioned = Array.from({ length: pageCount }, (_, index) => index + 1).filter((page) => !assigned.has(page));
  return { sections, unsectioned };
};

const PDFDocumentNavigator = ({
  pdfDoc,
  pageCount,
  currentPage,
  bookmarks = [],
  bookmarkLabels = {},
  customOutlines = [],
  onClose,
  onSelectPage,
  onToggleBookmark,
  onUpdateBookmark,
  onAddOutline,
  onUpdateOutline,
  onInsertBlankPage,
  onDeleteOutline,
  onChangeView,
  onOpenNavigator,
  activeView = "navigator",
}) => {
  const panelRef = useRef(null);
  const pageNodesRef = useRef(new Map());
  const [outlineDraft, setOutlineDraft] = useState(null);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [unsectionedOpen, setUnsectionedOpen] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const activeTab = activeView === "navigator" ? "navigator" : "outlines";
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const { sections, unsectioned } = useMemo(
    () => normalizeSections(customOutlines, pageCount),
    [customOutlines, pageCount],
  );
  useEffect(() => {
    if (activeSectionId && !sections.some((section) => section.id === activeSectionId)) setActiveSectionId(null);
  }, [activeSectionId, sections]);
  const registerNode = React.useCallback((page, node) => {
    if (!node) {
      pageNodesRef.current.delete(page);
      return;
    }
    pageNodesRef.current.set(page, node);
    if (page === currentPageRef.current) {
      window.requestAnimationFrame(() => {
        scrollPageNodeIntoPanel(panelRef.current, node);
        window.requestAnimationFrame(() => {
          scrollPageNodeIntoPanel(panelRef.current, node);
        });
      });
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const pageNode = pageNodesRef.current.get(currentPage);
      scrollPageNodeIntoPanel(panel, pageNode);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPage, sections, unsectioned]);

  const renderPage = (page, keyPrefix = "page", options = {}) => (
    <PdfMiniPage
      key={`${keyPrefix}-${page}`}
      pdfDoc={pdfDoc}
      pageNumber={page}
      active={page === currentPage}
      rangeEnd={outlineDraft?.endPage === page}
      bookmarked={bookmarks.includes(page)}
      bookmarkLabel={bookmarkLabels[page] || ""}
      onSelect={options.onSelect || onSelectPage}
      onSelectRangePage={!options.stacked && outlineDraft ? chooseOutlineEndPage : null}
      outlineDraft={options.stacked ? null : outlineDraft}
      onChangeOutlineTitle={(title) => setOutlineDraft((draft) => (draft ? { ...draft, title } : draft))}
      onSubmitOutline={submitOutline}
      onCancelOutline={() => setOutlineDraft(null)}
      onToggleBookmark={onToggleBookmark}
      onUpdateBookmark={onUpdateBookmark}
      onInsertBlankPage={onInsertBlankPage}
      registerNode={registerNode}
      stacked={Boolean(options.stacked)}
    />
  );

  const stopPropagation = (event) => event.stopPropagation();
  const openOutlineForm = (page) => {
    const startPage = clampPage(page, pageCount);
    setOutlineDraft({
      type: "section",
      title: "",
      startPage,
      endPage: startPage,
    });
  };
  const beginOutlineFromCurrentPage = () => {
    setActiveSectionId(null);
    setUnsectionedOpen(true);
    openOutlineForm(currentPage);
  };
  const submitOutline = (event) => {
    event.preventDefault();
    if (!outlineDraft?.title.trim()) return;
    const added = onAddOutline({
      type: outlineDraft.type,
      title: outlineDraft.title.trim(),
      startPage: outlineDraft.startPage,
      endPage: outlineDraft.endPage,
    });
    if (added !== false) setOutlineDraft(null);
  };

  const chooseOutlineEndPage = (page) => {
    setOutlineDraft((draft) => (draft && page >= draft.startPage ? { ...draft, endPage: page } : draft));
  };

  const selectSection = (sectionId) => {
    setActiveSectionId((current) => current === sectionId ? null : sectionId);
    window.requestAnimationFrame(() => {
      panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const openSection = (sectionId) => {
    const section = sections.find((candidate) => candidate.id === sectionId);
    // Keep the left structure aside mounted. Its outline rows focus the
    // dedicated right navigator instead of changing this panel's view and
    // producing a second navigator instance.
    if (activeTab !== "navigator") {
      if (section?.startPage) onSelectPage(section.startPage);
      onOpenNavigator?.();
      return;
    }
    setActiveSectionId(sectionId);
    window.requestAnimationFrame(() => panelRef.current?.scrollTo({ top: 0 }));
  };

  const visibleSections = activeSectionId ? sections.filter((section) => section.id === activeSectionId) : sections;

  const submitSectionTitle = (event) => {
    event.preventDefault();
    if (!editingSection?.title.trim()) return;
    if (onUpdateOutline(editingSection.id, editingSection.title) !== false) setEditingSection(null);
  };

  return (
    <aside
      ref={panelRef}
      id={activeTab === "navigator" ? "pdf_navigator_panel" : "pdf_outline_panel"}
      aria-label={activeTab === "navigator" ? "PDF page navigator" : "PDF document structure"}
      onWheel={stopPropagation}
      onTouchStart={stopPropagation}
      onTouchMove={stopPropagation}
      onTouchEnd={stopPropagation}
      onPointerDown={stopPropagation}
    >
      {activeTab === "navigator" && (
        <div aria-label="PDF pages">
          {Array.from({ length: pageCount }, (_, index) => renderPage(index + 1, "navigator"))}
        </div>
      )}

      {activeTab === "outlines" && <section className="pdf_outline_section">
        {outlineDraft ? (
          <form className="pdf_outline_draft_editor" onSubmit={submitOutline}>
            <h3>
              <i className="bx bx-list-ul" /> New Entity
              <span className="pdf_outline_draft_actions">
                <button type="submit" className="pdf_outline_apply" disabled={!outlineDraft.title.trim()} title="Apply outline" aria-label="Apply outline">Apply</button>
                <button type="button" className="pdf_outline_cancel" onClick={() => setOutlineDraft(null)} title="Cancel outline" aria-label="Cancel outline">Cancel</button>
              </span>
            </h3>
            <label className="pdf_outline_draft_field">
              <span>Type</span>
              <select value={outlineDraft.type} onChange={(event) => setOutlineDraft((draft) => ({ ...draft, type: event.target.value }))}>
                <option value="part">Part</option>
                <option value="chapter">Chapter</option>
                <option value="section">Section</option>
                <option value="subsection">Subsection</option>
                <option value="appendix">Appendix</option>
              </select>
            </label>
            <label className="pdf_outline_draft_field">
              <span>Title</span>
              <input type="text" value={outlineDraft.title} onChange={(event) => setOutlineDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="Enter title" autoFocus required />
            </label>
            <div className="pdf_outline_range_field">
              <div><span>Pages</span><strong>{outlineDraft.startPage}–{outlineDraft.endPage}</strong></div>
              <input type="range" min={outlineDraft.startPage} max={pageCount} value={outlineDraft.endPage} onChange={(event) => chooseOutlineEndPage(Number(event.target.value))} aria-label="Outline ending page" />
              <small>Starts at the currently open page. Slide the handle to choose the last page.</small>
            </div>
          </form>
        ) : (
          <h3>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 9c-1.3 0-2.4.84-2.82 2H13V2h-2v3H7.82A2.99 2.99 0 0 0 5 3C3.35 3 2 4.35 2 6s1.35 3 3 3c1.3 0 2.4-.84 2.82-2H11v10H7.82A2.99 2.99 0 0 0 5 15c-1.65 0-3 1.35-3 3s1.35 3 3 3c1.3 0 2.4-.84 2.82-2H11v3h2v-9h3.18c.41 1.16 1.51 2 2.82 2 1.65 0 3-1.35 3-3s-1.35-3-3-3M5 7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m0 12c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m14-6c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1" />
            </svg>
            Document Form
            <button type="button" className="pdf_outline_add" onClick={beginOutlineFromCurrentPage} title={`Add outline from current page ${currentPage}`} aria-label={`Add outline from current page ${currentPage}`}><i className="bx bx-plus" /></button>
          </h3>
        )}
        {customOutlines.length ? (
          <div className="pdf_custom_outline_items">
            {customOutlines.map((item) => (
              <div className="pdf_custom_outline_item" key={item.id}>
                {editingSection?.id === item.id ? (
                  <form className="pdf_custom_outline_edit_form" onSubmit={submitSectionTitle}>
                    <SelectionFreeInput value={editingSection.title} onChange={(event) => setEditingSection((current) => ({ ...current, title: event.target.value }))} ariaLabel={`Edit title for ${item.title}`} autoFocus />
                    <button type="submit" aria-label="Save section title" title="Save title"><i className="bx bx-check" /></button>
                    <button type="button" onClick={() => setEditingSection(null)} aria-label="Cancel title editing" title="Cancel"><i className="bx bx-x" /></button>
                  </form>
                ) : (
                  <>
                    <button type="button" onClick={() => openSection(item.id)} title={`Show pages ${item.startPage}–${item.endPage}`}>
                      <i className="bx bx-bookmark" aria-hidden="true" /><span>{item.title}</span>
                      <span className="pdf_custom_outline_meta"><small>pp. {item.startPage}–{item.endPage}</small><small>{item.endPage - item.startPage + 1} {item.endPage - item.startPage + 1 === 1 ? "page" : "pages"}</small></span>
                    </button>
                    <button type="button" className="pdf_custom_outline_edit" onClick={() => setEditingSection({ id: item.id, title: item.title })} title="Edit section title" aria-label={`Edit ${item.title}`}><i className="bx bx-pencil" /></button>
                  </>
                )}
                <button type="button" className="pdf_custom_outline_delete" onClick={() => onDeleteOutline(item.id)} title="Delete outline section" aria-label={`Delete ${item.title}`}><i className="bx bx-x" /></button>
              </div>
            ))}
          </div>
        ) : null}
        {!customOutlines.length && <p className="pdf_outline_empty">This PDF does not include an outline. Add a section with +.</p>}
      </section>}

    </aside>
  );
};

export default PDFDocumentNavigator;
