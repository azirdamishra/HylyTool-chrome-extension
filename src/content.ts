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
  });

  setupDeleteContextMenu();
}

window.addEventListener("load", () => {
  if (initComplete) {
    applyHighlightsOnce();
  }
});

// ---------------------------------------------------------------------------
// Delete via right-click context menu
//
// A small custom menu is shown only when the user right-clicks on a
// `.custom-highlight` span. This lets normal left-clicks fall through to any
// underlying link/button (the previous click-tooltip would intercept those
// and prevent users from following highlighted hyperlinks).
// ---------------------------------------------------------------------------

let activeHighlightId: string | null = null;
let deleteMenu: HTMLElement | null = null;

function setupDeleteContextMenu() {
  if (deleteMenu) return; // guard against double-init

  deleteMenu = document.createElement("div");
  Object.assign(deleteMenu.style, {
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

  deleteMenu.appendChild(removeItem);
  document.body.appendChild(deleteMenu);

  // Show on right-click over a highlight
  document.addEventListener("contextmenu", (e) => {
    if (!enabled) {
      hideDeleteMenu();
      return;
    }
    const target = e.target as Element | null;
    const highlight =
      target?.closest?.(".custom-highlight") as HTMLElement | null;
    if (!highlight?.id) {
      hideDeleteMenu();
      return;
    }
    e.preventDefault();
    activeHighlightId = highlight.id;
    showDeleteMenuAt(e.pageX, e.pageY);
  });

  // Hide on outside click, Escape, scroll, resize, or another contextmenu
  document.addEventListener("click", (e) => {
    if (!deleteMenu || deleteMenu.style.display === "none") return;
    const t = e.target as Node | null;
    if (t && deleteMenu.contains(t)) return;
    hideDeleteMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideDeleteMenu();
  });
  window.addEventListener("scroll", hideDeleteMenu, true);
  window.addEventListener("resize", hideDeleteMenu);
  window.addEventListener("blur", hideDeleteMenu);
}

function showDeleteMenuAt(pageX: number, pageY: number) {
  if (!deleteMenu) return;
  // Render off-screen first to measure, then clamp to viewport edges
  deleteMenu.style.display = "block";
  deleteMenu.style.top = "-9999px";
  deleteMenu.style.left = "-9999px";

  const menuRect = deleteMenu.getBoundingClientRect();
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

  deleteMenu.style.left = `${String(left)}px`;
  deleteMenu.style.top = `${String(top)}px`;
}

function hideDeleteMenu() {
  if (deleteMenu) deleteMenu.style.display = "none";
  activeHighlightId = null;
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
    hideDeleteMenu();
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
  hideDeleteMenu();
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
        // Stop creating new highlights and hide the delete context menu
        document.removeEventListener("mouseup", handleMouseUp);
        hideDeleteMenu();
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
      for (const entry of gapEntries) updated.push(entry);
      for (const entry of remEntries) updated.push(entry);

      enqueuePersistHighlights(pageKey, updated);
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
    for (const entry of gapEntries) updated.push(entry);
    for (const entry of remEntries2) updated.push(entry);
    enqueuePersistHighlights(pageKey, updated);
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
  updated.push(highlightData);
  for (const rem of remainderEntries) {
    updated.push(rem);
  }

  enqueuePersistHighlights(pageKey, updated);
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
