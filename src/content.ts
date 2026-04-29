"use strict";
import {
  reapplyHighlightsFromStorage,
  normalizeUrl,
  captureContext,
  captureContextAcross,
  applyGapFillToRange,
  syncGet,
  syncSet,
  findAllTextOccurrences,
  resolveOccurrenceIndex,
} from "./common";
import { HighlightData } from "./common";

const blurFilter = "blur(6px)";
let textToBlur = "";

//Search the DOM node for text to blur and blur only the specific text
function processNode(node: Node) {
  if (node.childNodes.length > 0) {
    Array.from(node.childNodes).forEach(processNode);
  }
  if (
    node.nodeType === Node.TEXT_NODE &&
    node.textContent !== null &&
    node.textContent.trim().length > 0
  ) {
    const parent = node.parentElement;
    if (parent == null) return;
    if (parent.tagName === "SCRIPT" || parent.style.filter === blurFilter) {
      //Already blurred
      return;
    }
    if (node.textContent.includes(textToBlur)) {
      // Create a document fragment to hold our modified content
      const fragment = document.createDocumentFragment();

      // Split the text by the blurred portion
      const parts = node.textContent.split(textToBlur);

      //Rebuild the content with blurred spans in the correct positions
      for (let i = 0; i < parts.length; i++) {
        //Add the regular text part
        if (parts[i]) {
          fragment.appendChild(document.createTextNode(parts[i]));
        }

        //Add the blurred span (except after the last part)
        if (i < parts.length - 1) {
          const blurSpan = document.createElement("span");
          blurSpan.style.filter = blurFilter;
          blurSpan.style.display = "inline";
          blurSpan.textContent = textToBlur;
          fragment.appendChild(blurSpan);
        }
      }

      //Replace the original node with our fragment containing ordered text
      parent.replaceChild(fragment, node);

      console.log("Blurred specific text:", textToBlur);
    }
  }
}

//Create a MutationObserver to watch for changes to the DOM
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.addedNodes.length > 0) {
      mutation.addedNodes.forEach(processNode);
    } else {
      processNode(mutation.target);
    }
  });
});

let enabled = false;
let highlightColor = "#FFF4B3";
const keys: ("enabled" | "item")[] = ["enabled", "item"];
let initComplete = false;
let cachedPageKey: string | null = null;
let cachedHighlights: HighlightData[] = [];
let highlightSaveQueue: Promise<void> = Promise.resolve();

function setHighlightCache(pageKey: string, highlights: HighlightData[]): void {
  cachedPageKey = pageKey;
  cachedHighlights = [...highlights];
}

function getCachedHighlights(pageKey: string): HighlightData[] {
  if (cachedPageKey !== pageKey) return [];
  return [...cachedHighlights];
}

function removePageKeyFromStorage(pageKey: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.remove(pageKey, () => {
      chrome.storage.local.remove(pageKey, () => resolve());
    });
  });
}

function enqueuePersistHighlights(
  pageKey: string,
  highlights: HighlightData[],
): void {
  const nextHighlights = [...highlights];
  setHighlightCache(pageKey, nextHighlights);
  highlightSaveQueue = highlightSaveQueue
    .then(async () => {
      await syncSet(pageKey, nextHighlights);
    })
    .catch(() => {});
}

function enqueueRemoveHighlight(pageKey: string, highlightId: string): void {
  const updated = getCachedHighlights(pageKey).filter((h) => h.id !== highlightId);
  setHighlightCache(pageKey, updated);
  highlightSaveQueue = highlightSaveQueue
    .then(async () => {
      if (updated.length === 0) {
        await removePageKeyFromStorage(pageKey);
      } else {
        await syncSet(pageKey, updated);
      }
    })
    .catch(() => {});
}

console.log("Content script initialized");

// Inject a stylesheet once so highlights with notes show a small badge.
// This runs at content-script load time, before any highlight is applied.
(function injectNoteStyles() {
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    .custom-highlight[data-has-note="true"]::after {
      content: "\u{1F4DD}";
      font-size: 0.75em;
      margin-left: 2px;
      vertical-align: super;
      cursor: help;
      user-select: none;
      pointer-events: none;
    }
  `;
  (document.head ?? document.documentElement).appendChild(styleEl);
})();

//Only start observing the DOM if the extension is enabled and there is text to blur
function observe() {
  if (enabled && textToBlur.trim().length > 0) {
    observer.observe(document, {
      attributes: false,
      characterData: true,
      childList: true,
      subtree: true,
    });

    processNode(document);
  } else {
    console.log("Not starting observation because:", {
      enabled,
      hasText: textToBlur.trim().length > 0,
    });
  }
}

chrome.storage.sync.get(keys, (data: { enabled?: boolean; item?: string }) => {
  console.log("Storage data received:", data);

  enabled = data.enabled !== false;
  if (!enabled) console.log("Extension disabled");

  if (data.item) {
    textToBlur = data.item;
    console.log("Text to blur set to:", textToBlur);
  }

  observe();

  chrome.storage.local.get(
    ["highlightColor"],
    (colorData: { highlightColor?: string }) => {
      if (colorData.highlightColor) {
        highlightColor = colorData.highlightColor;
      }

      if (enabled) {
        console.log("Setting up highlight event listener");
        document.addEventListener("mouseup", handleMouseUp);
      }

      initComplete = true;

      if (enabled && document.readyState === "complete") {
        applyHighlightsOnce();
      }
    },
  );
});

// Handle mouseup event for highlighting
function handleMouseUp() {
  if (!enabled) return;
  if (!chrome.runtime?.id) return;

  const selection = window.getSelection();
  if (selection?.toString()) {
    console.log("Selection made:", selection.toString());
    addHighlight();
  }
}

// React to highlight color changes from the popup
chrome.storage.onChanged.addListener(
  (
    changes: Record<string, chrome.storage.StorageChange>,
    namespace: string,
  ) => {
    if (namespace === "local") {
      const colorChange = changes.highlightColor;
      if (typeof colorChange !== "undefined") {
        const newValue: unknown = colorChange.newValue;
        if (typeof newValue === "string") {
          highlightColor = newValue;
          console.log("Highlight color changed to:", highlightColor);
        }
      }
    }
  },
);

let highlightsAppliedOnce = false;

function applyHighlightsOnce(): void {
  if (highlightsAppliedOnce || !enabled) return;
  highlightsAppliedOnce = true;

  const pageKey = normalizeUrl(window.location.href);
  console.log("Loading highlights for page:", pageKey);
  void syncGet(pageKey).then((highlights) => {
    setHighlightCache(pageKey, highlights);
    console.log("Found highlights:", highlights);
    reapplyHighlightsFromStorage(highlights);
    // Re-apply note indicators for every entry that has a note.
    for (const h of highlights) {
      if (h.note) {
        applyNoteToSpans(h.groupId ?? h.id, h.note);
      }
    }
  });

  setupHighlightContextMenu();
}

window.addEventListener("load", () => {
  if (initComplete) {
    applyHighlightsOnce();
  }
});

// ---------------------------------------------------------------------------
// Right-click context menu for highlights (delete + add/edit note)
//
// A small custom menu is shown only when the user right-clicks on a
// `.custom-highlight` span. This lets normal left-clicks fall through to any
// underlying link/button (the previous click-tooltip would intercept those
// and prevent users from following highlighted hyperlinks).
// ---------------------------------------------------------------------------

let activeHighlightId: string | null = null;
// The resolved storage id for the active highlight (groupId for compounds,
// span.id for simple). Used by both delete and note operations.
let activeStorageId: string | null = null;
let contextMenu: HTMLElement | null = null;
let noteMenuItem: HTMLElement | null = null;
let deleteNoteMenuItem: HTMLElement | null = null;
// Coordinates where the context menu was triggered — used to position the
// note editor at the same spot.
let menuPageX = 0;
let menuPageY = 0;

// ---------------------------------------------------------------------------
// Note indicator helpers
// ---------------------------------------------------------------------------

/**
 * Applies or removes the note indicator and tooltip from the DOM spans that
 * belong to a given storage entry.
 *
 * - For compound highlights all spans sharing `data-group=storageId` are
 *   updated; the badge (`data-has-note`) lives only on the last span.
 * - For simple highlights the single span with `id=storageId` is updated.
 */
function applyNoteToSpans(storageId: string, note: string | undefined): void {
  const hasNote = typeof note === "string" && note.trim().length > 0;

  // Collect all spans for this storage entry (group or simple).
  const groupSpans = Array.from(
    document.querySelectorAll<HTMLElement>(
      `.custom-highlight[data-group="${storageId}"]`,
    ),
  );
  const simpleSpan = document.getElementById(storageId) as HTMLElement | null;

  const spans: HTMLElement[] =
    groupSpans.length > 0
      ? groupSpans
      : simpleSpan
        ? [simpleSpan]
        : [];

  if (spans.length === 0) return;

  // Update title (native tooltip) on every span so the user can hover anywhere
  // over a multi-segment compound and still see the note.
  for (const span of spans) {
    if (hasNote && note) {
      span.title = note;
    } else {
      span.removeAttribute("title");
    }
    // Clear badge from all — we'll set it on the last one below.
    span.removeAttribute("data-has-note");
  }

  // Place the badge on the last span so it appears at the end of the highlight.
  const badgeSpan = spans[spans.length - 1];
  if (hasNote) {
    badgeSpan.setAttribute("data-has-note", "true");
  }
  // #region agent log
  try {
    const pseudo = window.getComputedStyle(badgeSpan, "::after");
    const parent = badgeSpan.parentNode as Element | null;
    const surroundingHTML = parent ? (parent as HTMLElement).innerHTML.slice(0, 400) : "";
    fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67856d'},body:JSON.stringify({sessionId:'67856d',runId:'note-save',hypothesisId:'H1',location:'content.ts:applyNoteToSpans-after',message:'post-save DOM snapshot',data:{hasNote,storageId,afterContent:pseudo.content,badgeOuterHTML:badgeSpan.outerHTML.slice(0,300),badgeTitle:badgeSpan.getAttribute("title")?.slice(0,80),badgeTextContent:badgeSpan.textContent?.slice(0,80),surroundingHTML,injectedCSSSnippet:document.querySelector("style")?.textContent?.slice(0,260)},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion
}

// ---------------------------------------------------------------------------
// Note editor
// ---------------------------------------------------------------------------

let noteEditor: HTMLElement | null = null;
let noteTextarea: HTMLTextAreaElement | null = null;

function buildNoteEditor(): void {
  if (noteEditor) return;

  noteEditor = document.createElement("div");
  Object.assign(noteEditor.style, {
    position: "absolute",
    background: "#ffffff",
    color: "#222",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "8px",
    padding: "10px",
    fontSize: "13px",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    zIndex: "2147483647",
    display: "none",
    boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
    minWidth: "220px",
    maxWidth: "320px",
  });

  noteTextarea = document.createElement("textarea");
  Object.assign(noteTextarea.style, {
    width: "100%",
    minHeight: "80px",
    resize: "vertical",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: "4px",
    padding: "6px",
    fontSize: "13px",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
    color: "#222",
    background: "#fafafa",
    display: "block",
    marginBottom: "8px",
  });
  noteTextarea.placeholder = "Add a note…";
  noteTextarea.setAttribute("rows", "4");

  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "6px",
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  Object.assign(cancelBtn.style, {
    padding: "4px 12px",
    fontSize: "12px",
    borderRadius: "4px",
    border: "1px solid rgba(0,0,0,0.15)",
    background: "#f0f0f0",
    cursor: "pointer",
    color: "#444",
  });
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideNoteEditor();
  });

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  Object.assign(saveBtn.style, {
    padding: "4px 12px",
    fontSize: "12px",
    borderRadius: "4px",
    border: "none",
    background: "#4f46e5",
    color: "#fff",
    cursor: "pointer",
    fontWeight: "600",
  });
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    saveActiveNote();
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);

  noteEditor.appendChild(noteTextarea);
  noteEditor.appendChild(btnRow);
  document.body.appendChild(noteEditor);

  // Keyboard shortcuts inside the editor
  noteEditor.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hideNoteEditor();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.stopPropagation();
      saveActiveNote();
    }
  });

  // Outside click dismissal
  document.addEventListener("click", (e) => {
    if (!noteEditor || noteEditor.style.display === "none") return;
    const t = e.target as Node | null;
    if (t && noteEditor.contains(t)) return;
    // #region agent log
    fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67856d'},body:JSON.stringify({sessionId:'67856d',hypothesisId:'H3',location:'content.ts:noteEditor.outsideClick',message:'outside click hiding editor',data:{targetTag:(t as Element|null)?.tagName,display:noteEditor.style.display},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    hideNoteEditor();
  });
  window.addEventListener("scroll", hideNoteEditor, true);
  window.addEventListener("resize", hideNoteEditor);
  window.addEventListener("blur", hideNoteEditor);
}

function showNoteEditorAt(pageX: number, pageY: number, existingNote: string): void {
  // #region agent log
  fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67856d'},body:JSON.stringify({sessionId:'67856d',hypothesisId:'H2',location:'content.ts:showNoteEditorAt-entry',message:'showNoteEditorAt called',data:{pageX,pageY,existingNoteLen:existingNote.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  buildNoteEditor();
  if (!noteEditor || !noteTextarea) return;

  noteTextarea.value = existingNote;

  // Render off-screen first to measure, then clamp to viewport
  noteEditor.style.display = "block";
  noteEditor.style.top = "-9999px";
  noteEditor.style.left = "-9999px";

  const rect = noteEditor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;

  const clientX = pageX - window.scrollX;
  const clientY = pageY - window.scrollY;

  const left =
    clientX + rect.width > vw - margin
      ? Math.max(margin, vw - rect.width - margin) + window.scrollX
      : pageX;
  const top =
    clientY + rect.height > vh - margin
      ? Math.max(margin, vh - rect.height - margin) + window.scrollY
      : pageY;

  noteEditor.style.left = `${String(left)}px`;
  noteEditor.style.top = `${String(top)}px`;

  // Focus and move cursor to end
  noteTextarea.focus();
  const len = noteTextarea.value.length;
  noteTextarea.setSelectionRange(len, len);

  // #region agent log
  const finalRect = noteEditor.getBoundingClientRect();
  fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67856d'},body:JSON.stringify({sessionId:'67856d',hypothesisId:'H2',location:'content.ts:showNoteEditorAt-rendered',message:'editor rendered',data:{left,top,rect:{x:finalRect.x,y:finalRect.y,w:finalRect.width,h:finalRect.height},display:noteEditor.style.display,zIndex:noteEditor.style.zIndex,activeElementTag:document.activeElement?.tagName},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

function hideNoteEditor(): void {
  if (noteEditor) noteEditor.style.display = "none";
}

function saveActiveNote(): void {
  // #region agent log
  fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67856d'},body:JSON.stringify({sessionId:'67856d',hypothesisId:'H5',location:'content.ts:saveActiveNote-entry',message:'saveActiveNote called',data:{activeStorageId,hasTextarea:!!noteTextarea,noteValueLen:noteTextarea?.value.length??-1},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!activeStorageId || !noteTextarea) return;

  const newNote = noteTextarea.value.trim();
  const pageKey = normalizeUrl(window.location.href);
  const existing = getCachedHighlights(pageKey);
  const updated = existing.map((h) => {
    if (h.id !== activeStorageId) return h;
    if (newNote.length === 0) {
      const copy = { ...h };
      delete copy.note;
      return copy;
    }
    return { ...h, note: newNote };
  });

  enqueuePersistHighlights(pageKey, updated);
  applyNoteToSpans(activeStorageId, newNote.length > 0 ? newNote : undefined);
  hideNoteEditor();
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function setupHighlightContextMenu() {
  if (contextMenu) return; // guard against double-init

  contextMenu = document.createElement("div");
  Object.assign(contextMenu.style, {
    position: "absolute",
    background: "#ffffff",
    color: "#222",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "6px",
    padding: "4px 0",
    fontSize: "13px",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    zIndex: "2147483647",
    display: "none",
    userSelect: "none",
    boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
    whiteSpace: "nowrap",
    minWidth: "150px",
  });

  // --- Remove highlight ---
  const removeItem = document.createElement("div");
  removeItem.textContent = "Remove highlight";
  Object.assign(removeItem.style, {
    padding: "6px 14px",
    cursor: "pointer",
    color: "#222",
  });
  removeItem.addEventListener("mouseenter", () => {
    removeItem.style.background = "#f0f0f0";
  });
  removeItem.addEventListener("mouseleave", () => {
    removeItem.style.background = "";
  });
  removeItem.addEventListener("click", (e) => {
    e.stopPropagation();
    removeActiveHighlight();
  });

  // --- Add / Edit note ---
  noteMenuItem = document.createElement("div");
  noteMenuItem.textContent = "Add note";
  Object.assign(noteMenuItem.style, {
    padding: "6px 14px",
    cursor: "pointer",
    color: "#222",
  });
  noteMenuItem.addEventListener("mouseenter", () => {
    if (noteMenuItem) noteMenuItem.style.background = "#f0f0f0";
  });
  noteMenuItem.addEventListener("mouseleave", () => {
    if (noteMenuItem) noteMenuItem.style.background = "";
  });
  noteMenuItem.addEventListener("click", (e) => {
    // #region agent log
    fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67856d'},body:JSON.stringify({sessionId:'67856d',runId:'post-fix',hypothesisId:'H1',location:'content.ts:noteMenuItem.click-entry',message:'note menu click: before hideContextMenu',data:{activeStorageId,activeHighlightId,menuPageX,menuPageY},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    e.stopPropagation();
    // Capture the target id BEFORE hideContextMenu() — hideContextMenu nulls
    // activeStorageId/activeHighlightId, and saveActiveNote needs them later.
    const targetStorageId = activeStorageId;
    const savedPageX = menuPageX;
    const savedPageY = menuPageY;
    hideContextMenu();
    // Restore activeStorageId so saveActiveNote can resolve the target entry.
    activeStorageId = targetStorageId;
    // #region agent log
    fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67856d'},body:JSON.stringify({sessionId:'67856d',runId:'post-fix',hypothesisId:'H1',location:'content.ts:noteMenuItem.click-after-hide',message:'note menu click: after hideContextMenu',data:{activeStorageIdAfterHide:activeStorageId,targetStorageId,willReturnEarly:!activeStorageId},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!activeStorageId) return;
    const pageKey = normalizeUrl(window.location.href);
    const highlights = getCachedHighlights(pageKey);
    const entry = highlights.find((h) => h.id === activeStorageId);
    showNoteEditorAt(savedPageX, savedPageY, entry?.note ?? "");
  });

  // --- Delete note (only shown when the target highlight has a note) ---
  deleteNoteMenuItem = document.createElement("div");
  deleteNoteMenuItem.textContent = "Delete note";
  Object.assign(deleteNoteMenuItem.style, {
    padding: "6px 14px",
    cursor: "pointer",
    color: "#c00",
    display: "none",
  });
  deleteNoteMenuItem.addEventListener("mouseenter", () => {
    if (deleteNoteMenuItem) deleteNoteMenuItem.style.background = "#fdecea";
  });
  deleteNoteMenuItem.addEventListener("mouseleave", () => {
    if (deleteNoteMenuItem) deleteNoteMenuItem.style.background = "";
  });
  deleteNoteMenuItem.addEventListener("click", (e) => {
    e.stopPropagation();
    const targetStorageId = activeStorageId;
    hideContextMenu();
    if (!targetStorageId) return;
    const pageKey = normalizeUrl(window.location.href);
    const existing = getCachedHighlights(pageKey);
    const updated = existing.map((h) => {
      if (h.id !== targetStorageId) return h;
      const copy = { ...h };
      delete copy.note;
      return copy;
    });
    enqueuePersistHighlights(pageKey, updated);
    applyNoteToSpans(targetStorageId, undefined);
  });

  contextMenu.appendChild(removeItem);
  contextMenu.appendChild(noteMenuItem);
  contextMenu.appendChild(deleteNoteMenuItem);
  document.body.appendChild(contextMenu);

  // Show on right-click over a highlight
  document.addEventListener("contextmenu", (e) => {
    if (!enabled) {
      hideContextMenu();
      return;
    }
    const target = e.target as Element | null;
    const highlight =
      target?.closest?.(".custom-highlight") as HTMLElement | null;
    if (!highlight?.id) {
      hideContextMenu();
      return;
    }
    e.preventDefault();
    activeHighlightId = highlight.id;
    // Resolve the canonical storage id: groupId takes priority for compounds.
    activeStorageId = highlight.getAttribute("data-group") ?? highlight.id;
    menuPageX = e.pageX;
    menuPageY = e.pageY;

    // Set note menu label dynamically based on whether a note already exists.
    const pageKey = normalizeUrl(window.location.href);
    const highlights = getCachedHighlights(pageKey);
    const entry = highlights.find((h) => h.id === activeStorageId);
    const hasNoteOnTarget =
      !!entry?.note && entry.note.trim().length > 0;
    if (noteMenuItem) {
      noteMenuItem.textContent = hasNoteOnTarget ? "Edit note" : "Add note";
    }
    if (deleteNoteMenuItem) {
      deleteNoteMenuItem.style.display = hasNoteOnTarget ? "block" : "none";
    }

    showContextMenuAt(e.pageX, e.pageY);
  });

  // Hide on outside click, Escape, scroll, resize
  document.addEventListener("click", (e) => {
    if (!contextMenu || contextMenu.style.display === "none") return;
    const t = e.target as Node | null;
    if (t && contextMenu.contains(t)) return;
    hideContextMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideContextMenu();
  });
  window.addEventListener("scroll", hideContextMenu, true);
  window.addEventListener("resize", hideContextMenu);
  window.addEventListener("blur", hideContextMenu);
}

function showContextMenuAt(pageX: number, pageY: number) {
  if (!contextMenu) return;
  // Render off-screen first to measure, then clamp to viewport edges
  contextMenu.style.display = "block";
  contextMenu.style.top = "-9999px";
  contextMenu.style.left = "-9999px";

  const menuRect = contextMenu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 4;

  const clientX = pageX - window.scrollX;
  const clientY = pageY - window.scrollY;

  const left =
    clientX + menuRect.width > vw - margin
      ? Math.max(margin, vw - menuRect.width - margin) + window.scrollX
      : pageX;
  const top =
    clientY + menuRect.height > vh - margin
      ? Math.max(margin, vh - menuRect.height - margin) + window.scrollY
      : pageY;

  contextMenu.style.left = `${String(left)}px`;
  contextMenu.style.top = `${String(top)}px`;
}

function hideContextMenu() {
  if (contextMenu) contextMenu.style.display = "none";
  activeHighlightId = null;
  activeStorageId = null;
}

function removeActiveHighlight() {
  if (!activeHighlightId) return;

  const span = document.getElementById(activeHighlightId);
  // If the right-clicked span is part of a compound (data-group), nuke the
  // entire group from the DOM AND remove the single compound storage entry.
  // This is what fixes "deleting half-page highlight requires sentence-by-
  // sentence" — one click removes the whole drag-select.
  const groupId = span?.getAttribute("data-group") ?? null;
  if (groupId) {
    const groupSpans = document.querySelectorAll(
      `.custom-highlight[data-group="${groupId}"]`,
    );
    groupSpans.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
      }
    });
    document.body.normalize();
    const pageKey = normalizeUrl(window.location.href);
    enqueueRemoveHighlight(pageKey, groupId);
    hideContextMenu();
    return;
  }

  if (span?.parentNode) {
    span.parentNode.replaceChild(
      document.createTextNode(span.textContent ?? ""),
      span,
    );
    document.body.normalize();
  }

  const pageKey = normalizeUrl(window.location.href);
  enqueueRemoveHighlight(pageKey, activeHighlightId);
  hideContextMenu();
}

chrome.runtime.onMessage.addListener(
  (
    request: { action: string; enabled?: boolean; text?: string },
    sender,
    sendResponse,
  ) => {
    if (request.action === "extensionStateChanged") {
      console.log("Received extension state change: ", request.enabled);
      enabled = request.enabled ?? false;
      const pageKey = normalizeUrl(window.location.href);

      if (enabled) {
        document.addEventListener("mouseup", handleMouseUp);
        highlightsAppliedOnce = false;
        applyHighlightsOnce();
      } else {
        // Stop creating new highlights and hide the context menu + note editor
        document.removeEventListener("mouseup", handleMouseUp);
        hideContextMenu();
        hideNoteEditor();
        // Remove all highlight spans from the DOM
        const highlights = document.querySelectorAll(".custom-highlight");
        highlights.forEach((el) => {
          const parent = el.parentNode;
          if (parent) {
            parent.replaceChild(
              document.createTextNode(el.textContent ?? ""),
              el,
            );
          }
        });
        document.body.normalize();
        setHighlightCache(pageKey, []);
        console.log("Removed highlights from DOM");
      }
    } else if (request.action === "applyBlur") {
      //Update the text to blur
      textToBlur = request.text ?? "";
      console.log("Applying blur to text: ", textToBlur);

      //Process the document with the new text to blur
      if (enabled) {
        //Remove existing blur before applying new
        removeAllBlurredElements();
        //Apply the new blur
        processNode(document);
        console.log("Blur applied without page reload");
      }

      //Send response back
      sendResponse({ success: true });
    } else if (request.action === "removeBlur") {
      //Clear the text to blur
      textToBlur = "";
      console.log("Removing the blur effects");

      //Remove all blur effects
      removeAllBlurredElements();

      //Send response back
      sendResponse({ success: true });
    }
  },
);

/**
 * Gap-fill: wraps each text node within a range individually.
 * Used when the selection spans multiple inline elements (e.g. <a>, <sup>)
 * and surroundContents / re-find cannot work on the full text.
 * Returns storage entries for each wrapped segment.
 */
function gapFillRange(
  range: Range,
  color: string,
  baseId: string,
): HighlightData[] {
  // Capture the FULL exact text of the selection — character-perfect,
  // including spacing and punctuation. This is what we'll search for on
  // reload using a document-wide concatenated-text buffer.
  const fullText = range.toString();
  if (!fullText) return [];

  // Snapshot endpoints BEFORE any DOM mutation so we can capture
  // prefix/suffix context that spans element boundaries.
  const startNode = range.startContainer;
  const startOff = range.startOffset;
  const endNode = range.endContainer;
  const endOff = range.endOffset;

  // captureContextAcross wants a Text node. Walk to the first Text at/after
  // the boundary for start, and last Text at/before the boundary for end.
  const firstTextInside = (() => {
    if (startNode.nodeType === Node.TEXT_NODE)
      return { node: startNode as Text, off: startOff };
    // startNode is an element; text at offset `startOff` is child at that index
    const child = startNode.childNodes[startOff];
    if (child && child.nodeType === Node.TEXT_NODE)
      return { node: child as Text, off: 0 };
    const walker = document.createTreeWalker(
      startNode,
      NodeFilter.SHOW_TEXT,
    );
    const first = walker.nextNode() as Text | null;
    return first ? { node: first, off: 0 } : null;
  })();
  const lastTextInside = (() => {
    if (endNode.nodeType === Node.TEXT_NODE)
      return { node: endNode as Text, off: endOff };
    const prior = endNode.childNodes[endOff - 1];
    if (prior && prior.nodeType === Node.TEXT_NODE)
      return { node: prior as Text, off: (prior as Text).length };
    return null;
  })();

  const startCtx = firstTextInside
    ? captureContextAcross(firstTextInside.node, firstTextInside.off, 0)
    : { prefixContext: "", suffixContext: "" };
  const endCtx = lastTextInside
    ? captureContextAcross(lastTextInside.node, lastTextInside.off, 0)
    : { prefixContext: "", suffixContext: "" };

  // Wrap every text node in the range and tag them all with data-group=baseId.
  const wrappedIds = applyGapFillToRange(range, color, baseId);

  if (wrappedIds.length === 0) return [];

  // ONE compound entry per drag-select regardless of segment count.
  const compound: HighlightData = {
    id: baseId,
    text: fullText,
    color,
    pageIndex: 0,
    prefixContext: startCtx.prefixContext,
    suffixContext: endCtx.suffixContext,
    groupId: baseId,
    compound: true,
  };
  return [compound];
}

/**
 * Re-applies remainder portions of partially-covered highlights.
 * Returns storage entries for each successfully re-applied remainder.
 *
 * Picks the occurrence whose visual position is closest to where the
 * remainder originally was (captured before unwrap). Without this, the
 * remainder gets dropped on the first matching occurrence in document
 * order — which is wrong whenever the remainder text appears multiple
 * times on the page.
 */
function applyRemainders(
  remainders: Array<{ text: string; color: string; origRect: DOMRect | null }>,
): HighlightData[] {
  const entries: HighlightData[] = [];
  for (const rem of remainders) {
    const normalizedRem = rem.text.trim().replace(/\s+/g, " ");
    if (!normalizedRem) continue;

    const remOccurrences = findAllTextOccurrences(normalizedRem);
    if (remOccurrences.length === 0) continue;

    // Pick the occurrence visually closest to the original remainder position
    let bestIdx = 0;
    if (rem.origRect && remOccurrences.length > 1) {
      let bestDist = Infinity;
      for (let i = 0; i < remOccurrences.length; i++) {
        const r = document.createRange();
        r.setStart(remOccurrences[i].node, remOccurrences[i].startOffset);
        r.setEnd(
          remOccurrences[i].node,
          remOccurrences[i].startOffset + remOccurrences[i].text.length,
        );
        const rect = r.getBoundingClientRect();
        const dx = rect.left - rem.origRect.left;
        const dy = rect.top - rem.origRect.top;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
    }
    const remOcc = remOccurrences[bestIdx];
    const remId = `highlight-${String(Date.now())}-${String(Math.random().toString(36).substring(2, 9))}`;
    const { prefixContext: remPrefix, suffixContext: remSuffix } =
      captureContext(remOcc.node, remOcc.startOffset, remOcc.text.length);

    const remRange = document.createRange();
    remRange.setStart(remOcc.node, remOcc.startOffset);
    remRange.setEnd(remOcc.node, remOcc.startOffset + remOcc.text.length);

    const remSpan = document.createElement("span");
    remSpan.className = "custom-highlight";
    remSpan.id = remId;
    remSpan.style.backgroundColor = rem.color;

    try {
      remRange.surroundContents(remSpan);
      entries.push({
        id: remId,
        text: normalizedRem,
        color: rem.color,
        pageIndex: 0,
        prefixContext: remPrefix,
        suffixContext: remSuffix,
      });
    } catch {
      // Could not re-apply remainder
    }
  }
  return entries;
}

/**
 * Adds a highlight to the current selection.
 *
 * Overlap strategy: new color wins entirely. Any existing highlight that
 * intersects the selection is unwrapped first (DOM cleaned), then the new
 * highlight is applied via surroundContents on a clean range.
 *
 * NEVER uses extractContents — that destroys page structure.
 */
function addHighlight() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  let range = selection.getRangeAt(0);
  if (range.collapsed) return;

  const selectedText = range.toString().trim();
  if (!selectedText) return;

  const cleanedText =
    selectedText.length > 500 ? selectedText.substring(0, 500) : selectedText;
  const color = highlightColor || getNextHighlightColor();

  // Capture the selection's visual position BEFORE any DOM mutations.
  // When re-highlighting text already inside a `.custom-highlight` span,
  // captureContext() can't see useful surrounding text (the span isolates the
  // chars), so we use visual proximity to relocate to the correct occurrence
  // after unwrapping.
  const origRect = range.getBoundingClientRect();
  let { prefixContext, suffixContext } = captureContext(
    range.startContainer as Text,
    range.startOffset,
    cleanedText.length,
  );

  // Collect IDs of every existing highlight that intersects the selection
  const touchedHighlightIds = new Set<string>();
  const touchedGroupIds = new Set<string>();
  document.querySelectorAll(".custom-highlight").forEach((span) => {
    try {
      if (span.id && range.intersectsNode(span)) {
        touchedHighlightIds.add(span.id);
        const g = span.getAttribute("data-group");
        if (g) touchedGroupIds.add(g);
      }
    } catch {
      /* non-intersectable */
    }
  });

  // Predicate: does this stored entry represent a touched highlight?
  // Matches simple entries by id AND compound entries by their stored id
  // (which equals groupId) or explicit groupId field. DOM spans for compound
  // segments have id = `${groupId}-s${n}` so the stored compound id won't be
  // in touchedHighlightIds — we must also check touchedGroupIds.
  const isTouched = (h: HighlightData): boolean =>
    touchedHighlightIds.has(h.id) ||
    touchedGroupIds.has(h.id) ||
    (h.groupId !== undefined && touchedGroupIds.has(h.groupId));

  // Preserve any note from touched entries so that re-highlighting the same
  // text (or a different color over it) does NOT silently drop the note.
  // If multiple touched entries have notes, the first one wins — acceptable
  // for the common case of overlapping a single noted highlight.
  const preservedPageKey = normalizeUrl(window.location.href);
  const cachedForNote = getCachedHighlights(preservedPageKey);
  const touchedNote = cachedForNote.find(
    (h) => isTouched(h) && typeof h.note === "string" && h.note.trim().length > 0,
  )?.note;
  const withNote = <T extends HighlightData>(entry: T): T =>
    touchedNote ? { ...entry, note: touchedNote } : entry;

  // Skip if fully inside a single existing highlight OF THE SAME COLOR
  if (touchedHighlightIds.size === 1) {
    const onlyId = [...touchedHighlightIds][0];
    const parentSpan = document.getElementById(onlyId);
    if (parentSpan && parentSpan.contains(range.startContainer) && parentSpan.contains(range.endContainer)) {
      const existingColor = parentSpan.style.backgroundColor || "";
      if (existingColor === color) {
        return;
      }
    }
  }

  // --- Step 0.5: Classify each touched highlight as fully or partially covered ---
  interface RemainderInfo {
    text: string;
    color: string;
    /** Bounding rect captured BEFORE unwrap so we can re-locate the
     *  exact occurrence after the DOM is mutated. Without this, multiple
     *  occurrences of the remainder text get disambiguated as "the first
     *  one in document order" and the highlight jumps elsewhere. */
    origRect: DOMRect | null;
  }
  const remainders: RemainderInfo[] = [];

  for (const id of touchedHighlightIds) {
    const span = document.getElementById(id);
    if (!span) continue;

    const spanText = span.textContent ?? "";
    const spanRange = document.createRange();
    spanRange.selectNodeContents(span);

    const selStartsBeforeSpan =
      range.compareBoundaryPoints(Range.START_TO_START, spanRange) <= 0;
    const selEndsAfterSpan =
      range.compareBoundaryPoints(Range.END_TO_END, spanRange) >= 0;

    if (selStartsBeforeSpan && selEndsAfterSpan) {
      continue;
    }

    const spanColor = span.style.backgroundColor || span.getAttribute("data-color") || "";

    if (selStartsBeforeSpan && !selEndsAfterSpan) {
      const overlapRange = document.createRange();
      overlapRange.setStart(spanRange.startContainer, spanRange.startOffset);
      overlapRange.setEnd(range.endContainer, range.endOffset);
      const overlapLen = overlapRange.toString().length;
      const rem = spanText.slice(overlapLen);
      if (rem.trim()) {
        // Remainder is the right portion of the span — capture its rect
        const remRange = document.createRange();
        remRange.setStart(range.endContainer, range.endOffset);
        remRange.setEnd(spanRange.endContainer, spanRange.endOffset);
        remainders.push({ text: rem, color: spanColor, origRect: remRange.getBoundingClientRect() });
      }
    } else if (!selStartsBeforeSpan && selEndsAfterSpan) {
      const overlapRange = document.createRange();
      overlapRange.setStart(range.startContainer, range.startOffset);
      overlapRange.setEnd(spanRange.endContainer, spanRange.endOffset);
      const overlapLen = overlapRange.toString().length;
      const rem = spanText.slice(0, spanText.length - overlapLen);
      if (rem.trim()) {
        // Remainder is the left portion of the span — capture its rect
        const remRange = document.createRange();
        remRange.setStart(spanRange.startContainer, spanRange.startOffset);
        remRange.setEnd(range.startContainer, range.startOffset);
        remainders.push({ text: rem, color: spanColor, origRect: remRange.getBoundingClientRect() });
      }
    } else if (!selStartsBeforeSpan && !selEndsAfterSpan) {
      const prefixRange = document.createRange();
      prefixRange.setStart(spanRange.startContainer, spanRange.startOffset);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const prefixText = prefixRange.toString();
      if (prefixText.trim()) {
        remainders.push({ text: prefixText, color: spanColor, origRect: prefixRange.getBoundingClientRect() });
      }

      const suffixRange = document.createRange();
      suffixRange.setStart(range.endContainer, range.endOffset);
      suffixRange.setEnd(spanRange.endContainer, spanRange.endOffset);
      const suffixText = suffixRange.toString();
      if (suffixText.trim()) {
        remainders.push({ text: suffixText, color: spanColor, origRect: suffixRange.getBoundingClientRect() });
      }
    }
  }

  // For every compound group that has ANY segment touched by the selection,
  // preserve the UNTOUCHED segments as full remainders and mark them for
  // unwrap. The compound's single storage entry is being removed below
  // (its id === groupId is in touchedGroupIds), so without this the
  // untouched portions of the old compound would vanish on reload.
  for (const gid of touchedGroupIds) {
    const groupSpans = document.querySelectorAll<HTMLElement>(
      `.custom-highlight[data-group="${gid}"]`,
    );
    groupSpans.forEach((el) => {
      if (!el.id || touchedHighlightIds.has(el.id)) return;
      const segText = el.textContent ?? "";
      if (!segText.trim()) return;
      const segColor =
        el.style.backgroundColor || el.getAttribute("data-color") || "";
      const segRect = el.getBoundingClientRect();
      remainders.push({ text: segText, color: segColor, origRect: segRect });
      touchedHighlightIds.add(el.id);
    });
  }

  // --- Step 1: Unwrap any touched highlights so surroundContents won't fail ---
  let needsRelocate = false;
  if (touchedHighlightIds.size > 0) {
    for (const id of touchedHighlightIds) {
      const span = document.getElementById(id);
      if (span?.parentNode) {
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      }
    }
    document.body.normalize();
    needsRelocate = true;
  }

  // --- Step 2: If we unwrapped anything, re-find the text in the clean DOM ---
  let usedGapFill = false;
  const highlightId = `highlight-${String(Date.now())}-${String(Math.random().toString(36).substring(2, 9))}`;

  if (needsRelocate) {
    selection.removeAllRanges();
    const normalizedText = cleanedText.trim().replace(/\s+/g, " ");
    const occurrences = findAllTextOccurrences(normalizedText);

    if (occurrences.length === 0) {
      // Text spans multiple inline elements — use gap-fill approach
      const gapEntries = gapFillRange(range, color, highlightId);
      const remEntries = applyRemainders(remainders);

      if (gapEntries.length === 0 && remEntries.length === 0) {
        return;
      }

      const pageKey = normalizeUrl(window.location.href);
      const existing = getCachedHighlights(pageKey);
      const updated = existing.filter((h) => !isTouched(h));
      for (const entry of gapEntries) updated.push(withNote(entry));
      for (const entry of remEntries) updated.push(withNote(entry));

      enqueuePersistHighlights(pageKey, updated);
      // Re-apply the preserved note to the freshly-wrapped DOM spans.
      if (touchedNote) {
        for (const entry of gapEntries) {
          applyNoteToSpans(entry.groupId ?? entry.id, touchedNote);
        }
        for (const entry of remEntries) {
          applyNoteToSpans(entry.groupId ?? entry.id, touchedNote);
        }
      }
      return;
    }

    // Pick the occurrence whose visual position is closest to the original
    // selection. This is the only reliable signal when the selection started
    // inside an existing highlight span (where prefix/suffix context is
    // unreliable because the span isolated the text).
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < occurrences.length; i++) {
      const occRange = document.createRange();
      occRange.setStart(occurrences[i].node, occurrences[i].startOffset);
      occRange.setEnd(
        occurrences[i].node,
        occurrences[i].startOffset + occurrences[i].text.length,
      );
      const r = occRange.getBoundingClientRect();
      const dx = r.left - origRect.left;
      const dy = r.top - origRect.top;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const best = occurrences[bestIdx];

    range = document.createRange();
    range.setStart(best.node, best.startOffset);
    range.setEnd(best.node, best.startOffset + best.text.length);

    // Re-capture context from the clean text node so it's accurate for
    // future reloads.
    const recaptured = captureContext(
      best.node,
      best.startOffset,
      best.text.length,
    );
    prefixContext = recaptured.prefixContext;
    suffixContext = recaptured.suffixContext;
  }

  // --- Step 3: Apply highlight via surroundContents (safe, no extractContents) ---
  const highlightElement = document.createElement("span");
  highlightElement.className = "custom-highlight";
  highlightElement.id = highlightId;
  highlightElement.style.backgroundColor = color;

  try {
    range.surroundContents(highlightElement);
  } catch {
    // surroundContents failed — try gap-fill as last resort
    const gapEntries = gapFillRange(range, color, highlightId);
    const remEntries2 = applyRemainders(remainders);
    if (gapEntries.length === 0 && remEntries2.length === 0) return;

    const pageKey = normalizeUrl(window.location.href);
    const existing = getCachedHighlights(pageKey);
    const updated = existing.filter((h) => !isTouched(h));
    for (const entry of gapEntries) updated.push(withNote(entry));
    for (const entry of remEntries2) updated.push(withNote(entry));
    enqueuePersistHighlights(pageKey, updated);
    if (touchedNote) {
      for (const entry of gapEntries) {
        applyNoteToSpans(entry.groupId ?? entry.id, touchedNote);
      }
      for (const entry of remEntries2) {
        applyNoteToSpans(entry.groupId ?? entry.id, touchedNote);
      }
    }
    return;
  }

  // --- Step 3.5: Re-apply remainder portions of partially-covered highlights ---
  const remainderEntries = applyRemainders(remainders);

  // --- Step 4: Persist — remove old touched, add new + remainders ---
  const highlightData: HighlightData = {
    id: highlightId,
    text: cleanedText,
    color,
    pageIndex: 0,
    prefixContext,
    suffixContext,
  };

  const pageKey = normalizeUrl(window.location.href);
  const existing = getCachedHighlights(pageKey);
  const updated = existing.filter((h) => !isTouched(h));
  const newMain = withNote(highlightData);
  updated.push(newMain);
  for (const rem of remainderEntries) {
    updated.push(withNote(rem));
  }

  enqueuePersistHighlights(pageKey, updated);
  // Re-apply the preserved note to the new spans so the visible badge +
  // tooltip show up immediately without needing a reload.
  if (touchedNote) {
    applyNoteToSpans(newMain.groupId ?? newMain.id, touchedNote);
    for (const rem of remainderEntries) {
      applyNoteToSpans(rem.groupId ?? rem.id, touchedNote);
    }
  }
}

// Helper function to get the next color from the rotation
function getNextHighlightColor(): string {
  const highlightColors = [
    "#FFF4B3", // Butter Yellow
    "#FFD1DC", // Cotton Candy Pink
    "#B5EAD7", // Mint
    "#C7CEEA", // Periwinkle
    "#FFDAC1", // Peach
  ];

  // Get the current index from storage or use 0 as default
  let currentColorIndex = parseInt(
    localStorage.getItem("currentColorIndex") ?? "0",
  );

  // Get the color to use
  const color = highlightColors[currentColorIndex];

  // Update the index for next time
  currentColorIndex = (currentColorIndex + 1) % highlightColors.length;
  localStorage.setItem("currentColorIndex", currentColorIndex.toString());

  return color;
}

//Helper function to remove all blurred elements
function removeAllBlurredElements() {
  const blurredElements = document.querySelectorAll(
    `span[style*="${blurFilter}"]`,
  );
  blurredElements.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      //Replace the blurred span with its text content
      parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
    }
  });

  //Normalize the document to clean up text nodes
  document.body.normalize();
  console.log(`Removed ${String(blurredElements.length)} blurred elements`);
}
