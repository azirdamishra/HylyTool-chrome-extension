"use strict";
import {
  reapplyHighlightsFromStorage,
  normalizeUrl,
  captureContext,
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
let highlightColor = "#FFFF00";
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

  setupDeleteTooltip();
}

window.addEventListener("load", () => {
  if (initComplete) {
    applyHighlightsOnce();
  }
});

// ---------------------------------------------------------------------------
// Delete tooltip
// ---------------------------------------------------------------------------

let activeHighlightId: string | null = null;
let deleteTooltip: HTMLElement | null = null;

function setupDeleteTooltip() {
  if (deleteTooltip) return; // guard against double-init

  deleteTooltip = document.createElement("div");
  Object.assign(deleteTooltip.style, {
    position: "absolute",
    background: "#222",
    color: "#fff",
    borderRadius: "4px",
    padding: "5px 10px",
    fontSize: "12px",
    cursor: "pointer",
    zIndex: "2147483647",
    display: "none",
    userSelect: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
    whiteSpace: "nowrap",
    lineHeight: "1.4",
  });
  deleteTooltip.textContent = "Remove highlight";
  document.body.appendChild(deleteTooltip);

  // Delegated click: show tooltip when a highlight is clicked
  document.addEventListener("click", (e) => {
    if (!enabled) return;
    const target = e.target as Element;

    // If the tooltip itself was clicked, let its own listener handle it
    if (deleteTooltip && (target === deleteTooltip || deleteTooltip.contains(target))) {
      return;
    }

    const highlight = target.closest(".custom-highlight") as HTMLElement | null;
    if (highlight) {
      activeHighlightId = highlight.id;
      const rect = highlight.getBoundingClientRect();
      if (deleteTooltip) {
        deleteTooltip.style.display = "block";
        // Position above the span; fall back to below if near the top of viewport
        const spaceAbove = rect.top;
        const tooltipHeight = 30; // approximate
        const top =
          spaceAbove > tooltipHeight + 8
            ? window.scrollY + rect.top - tooltipHeight - 6
            : window.scrollY + rect.bottom + 6;
        deleteTooltip.style.top = `${String(top)}px`;
        deleteTooltip.style.left = `${String(window.scrollX + rect.left)}px`;
      }
      e.stopPropagation();
    } else {
      if (deleteTooltip) deleteTooltip.style.display = "none";
      activeHighlightId = null;
    }
  });

  deleteTooltip.addEventListener("click", () => {
    if (!activeHighlightId) return;

    const span = document.getElementById(activeHighlightId);
    if (span?.parentNode) {
      span.parentNode.replaceChild(
        document.createTextNode(span.textContent ?? ""),
        span,
      );
      document.body.normalize();
    }

    const pageKey = normalizeUrl(window.location.href);
    enqueueRemoveHighlight(pageKey, activeHighlightId);

    if (deleteTooltip) deleteTooltip.style.display = "none";
    activeHighlightId = null;
  });
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
        // Stop creating new highlights and hide the delete tooltip
        document.removeEventListener("mouseup", handleMouseUp);
        if (deleteTooltip) {
          deleteTooltip.style.display = "none";
          activeHighlightId = null;
        }
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
  const ancestor = range.commonAncestorContainer;
  const walkRoot =
    ancestor.nodeType === Node.TEXT_NODE
      ? ancestor.parentNode!
      : ancestor;
  const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT);

  const segments: { node: Text; start: number; end: number }[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    try {
      if (!range.intersectsNode(cur)) continue;
    } catch {
      continue;
    }
    const tn = cur as Text;
    const p = tn.parentNode;
    if (!p || p.nodeName === "SCRIPT" || p.nodeName === "STYLE") continue;
    if (!tn.textContent || !tn.textContent.trim()) continue;

    let sOff = 0;
    let eOff = tn.length;
    if (tn === range.startContainer) sOff = range.startOffset;
    if (tn === range.endContainer) eOff = range.endOffset;
    if (sOff >= eOff) continue;

    const seg = tn.textContent.substring(sOff, eOff);
    if (!seg.trim()) continue;
    segments.push({ node: tn, start: sOff, end: eOff });
  }

  const entries: HighlightData[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const { node: tn, start: sOff, end: eOff } = segments[i];
    const seg = tn.textContent?.substring(sOff, eOff) ?? "";
    const segId = `${baseId}-s${String(i)}`;
    const { prefixContext: sp, suffixContext: ss } = captureContext(
      tn,
      sOff,
      seg.length,
    );

    const segRange = document.createRange();
    segRange.setStart(tn, sOff);
    segRange.setEnd(tn, eOff);

    const span = document.createElement("span");
    span.className = "custom-highlight";
    span.id = segId;
    span.style.backgroundColor = color;

    try {
      segRange.surroundContents(span);
      entries.push({
        id: segId,
        text: seg,
        color,
        pageIndex: 0,
        prefixContext: sp,
        suffixContext: ss,
      });
    } catch {
      // Skip segments that can't be wrapped
    }
  }

  return entries;
}

/**
 * Re-applies remainder portions of partially-covered highlights.
 * Returns storage entries for each successfully re-applied remainder.
 */
function applyRemainders(
  remainders: Array<{ text: string; color: string }>,
): HighlightData[] {
  const entries: HighlightData[] = [];
  for (const rem of remainders) {
    const normalizedRem = rem.text.trim().replace(/\s+/g, " ");
    if (!normalizedRem) continue;

    const remOccurrences = findAllTextOccurrences(normalizedRem);
    if (remOccurrences.length === 0) continue;

    const remOcc = remOccurrences[0];
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

  // Capture context before any DOM mutations
  const { prefixContext, suffixContext } = captureContext(
    range.startContainer as Text,
    range.startOffset,
    cleanedText.length,
  );

  // Collect IDs of every existing highlight that intersects the selection
  const touchedHighlightIds = new Set<string>();
  document.querySelectorAll(".custom-highlight").forEach((span) => {
    try {
      if (span.id && range.intersectsNode(span)) {
        touchedHighlightIds.add(span.id);
      }
    } catch {
      /* non-intersectable */
    }
  });

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
      if (rem.trim()) remainders.push({ text: rem, color: spanColor });
    } else if (!selStartsBeforeSpan && selEndsAfterSpan) {
      const overlapRange = document.createRange();
      overlapRange.setStart(range.startContainer, range.startOffset);
      overlapRange.setEnd(spanRange.endContainer, spanRange.endOffset);
      const overlapLen = overlapRange.toString().length;
      const rem = spanText.slice(0, spanText.length - overlapLen);
      if (rem.trim()) remainders.push({ text: rem, color: spanColor });
    } else if (!selStartsBeforeSpan && !selEndsAfterSpan) {
      const prefixRange = document.createRange();
      prefixRange.setStart(spanRange.startContainer, spanRange.startOffset);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const prefixText = prefixRange.toString();
      if (prefixText.trim()) remainders.push({ text: prefixText, color: spanColor });

      const suffixRange = document.createRange();
      suffixRange.setStart(range.endContainer, range.endOffset);
      suffixRange.setEnd(spanRange.endContainer, spanRange.endOffset);
      const suffixText = suffixRange.toString();
      if (suffixText.trim()) remainders.push({ text: suffixText, color: spanColor });
    }
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
      const updated = existing.filter((h) => !touchedHighlightIds.has(h.id));
      for (const entry of gapEntries) updated.push(entry);
      for (const entry of remEntries) updated.push(entry);

      enqueuePersistHighlights(pageKey, updated);
      return;
    }

    const bestIdx = resolveOccurrenceIndex(occurrences, {
      id: "", text: cleanedText, color,
      prefixContext, suffixContext,
    });
    const best = occurrences[bestIdx];

    range = document.createRange();
    range.setStart(best.node, best.startOffset);
    range.setEnd(best.node, best.startOffset + best.text.length);
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
    const updated = existing.filter((h) => !touchedHighlightIds.has(h.id));
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
  const updated = existing.filter((h) => !touchedHighlightIds.has(h.id));
  updated.push(highlightData);
  for (const rem of remainderEntries) {
    updated.push(rem);
  }

  enqueuePersistHighlights(pageKey, updated);
}

// Helper function to get the next color from the rotation
function getNextHighlightColor(): string {
  const highlightColors = [
    "#FFFF00", // Yellow
    "#7FFFD4", // Aquamarine
    "#FF69B4", // Hot Pink
    "#FFA500", // Orange
    "#00FFFF", // Cyan
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
