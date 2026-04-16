export function setBadgeText(enabled: boolean) {
  const text = enabled ? "ON" : "OFF";
  void chrome.action.setBadgeText({ text: text });
}

export interface HighlightData {
  id: string;
  text: string;
  color: string;
  pageIndex?: number;
  totalInstances?: number;
  prefixContext?: string;
  suffixContext?: string;
}

// ---------------------------------------------------------------------------
// URL normalisation
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "msclkid",
  "_ga",
  "_gl",
  "mc_eid",
  "mc_cid",
  "ref",
  "referrer",
]);

/**
 * Returns a canonical version of the URL with known tracking query params
 * removed. Content-defining params (e.g. search queries, doc IDs) are kept.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
    const search = parsed.searchParams.toString()
      ? `?${parsed.searchParams.toString()}`
      : "";
    return `${parsed.origin}${parsed.pathname}${search}${parsed.hash}`;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Context capture & scoring
// ---------------------------------------------------------------------------

const CONTEXT_SIZE = 30;

/**
 * Captures the text immediately before and after a highlight within its
 * containing text node. Used to relocate the correct occurrence even after
 * page structure changes.
 */
export function captureContext(
  node: Text,
  startOffset: number,
  length: number,
): { prefixContext: string; suffixContext: string } {
  const t = node.textContent ?? "";
  return {
    prefixContext: t.slice(Math.max(0, startOffset - CONTEXT_SIZE), startOffset),
    suffixContext: t.slice(
      startOffset + length,
      startOffset + length + CONTEXT_SIZE,
    ),
  };
}

/**
 * Scores how well an occurrence matches the stored context.
 * Range: 0 – 4, plus 0.5 tiebreaker for matching original pageIndex.
 */
function scoreOccurrenceByContext(
  occ: { node: Text; startOffset: number; text: string },
  item: HighlightData,
  occurrenceIndex: number,
): number {
  let score = 0;
  const t = occ.node.textContent ?? "";
  const actualPrefix = t.slice(
    Math.max(0, occ.startOffset - CONTEXT_SIZE),
    occ.startOffset,
  );
  const actualSuffix = t.slice(
    occ.startOffset + occ.text.length,
    occ.startOffset + occ.text.length + CONTEXT_SIZE,
  );

  if (item.prefixContext) {
    if (actualPrefix === item.prefixContext) {
      score += 2;
    } else if (
      actualPrefix.includes(item.prefixContext) ||
      item.prefixContext.includes(actualPrefix)
    ) {
      score += 1;
    }
  }

  if (item.suffixContext) {
    if (actualSuffix === item.suffixContext) {
      score += 2;
    } else if (
      actualSuffix.includes(item.suffixContext) ||
      item.suffixContext.includes(actualSuffix)
    ) {
      score += 1;
    }
  }

  // Small tiebreaker: prefer the occurrence at the original index
  if (occurrenceIndex === item.pageIndex) {
    score += 0.5;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

/**
 * Serialises all URL-keyed highlight entries from chrome.storage.sync to a
 * JSON string suitable for download.
 */
export async function exportHighlights(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (allData: Record<string, unknown>) => {
      const highlights: Record<string, HighlightData[]> = {};
      for (const [key, value] of Object.entries(allData)) {
        // Only include entries whose key looks like a URL
        if (key.startsWith("http") && Array.isArray(value)) {
          highlights[key] = value as HighlightData[];
        }
      }
      resolve(JSON.stringify(highlights, null, 2));
    });
  });
}

/**
 * Parses an exported JSON string and writes each URL entry back to
 * chrome.storage.sync, with a per-item quota fallback to local storage.
 */
export async function importHighlights(json: string): Promise<void> {
  let parsed: Record<string, HighlightData[]>;
  try {
    parsed = JSON.parse(json) as Record<string, HighlightData[]>;
  } catch (e) {
    console.error("importHighlights: invalid JSON", e);
    return;
  }

  for (const [pageKey, highlights] of Object.entries(parsed)) {
    if (!pageKey.startsWith("http") || !Array.isArray(highlights)) continue;
    await syncSet(pageKey, highlights);
  }
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Writes highlights to chrome.storage.sync, falling back to local storage if
 * the sync quota is exceeded.
 */
export async function syncSet(
  pageKey: string,
  highlights: HighlightData[],
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [pageKey]: highlights }, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message ?? "";
        if (
          msg.includes("QUOTA_BYTES_PER_ITEM") ||
          msg.includes("quota") ||
          msg.includes("QuotaExceeded")
        ) {
          console.warn(
            `Sync quota exceeded for "${pageKey}", falling back to local storage.`,
          );
          // Persist the flag so the popup can show a visible warning
          chrome.storage.local.set(
            { [pageKey]: highlights, syncQuotaExceeded: true },
            () => {
              resolve();
            },
          );
        } else {
          console.error("syncSet error:", chrome.runtime.lastError);
          resolve();
        }
      } else {
        resolve();
      }
    });
  });
}

/**
 * Reads highlights for a page key, checking sync first then local (covers the
 * quota-fallback case where a page's data ended up in local).
 */
export async function syncGet(pageKey: string): Promise<HighlightData[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      [pageKey],
      (syncData: Record<string, HighlightData[]>) => {
        if (syncData[pageKey]) {
          resolve(syncData[pageKey]);
          return;
        }
        // Not in sync — check local (quota-fallback path)
        chrome.storage.local.get(
          [pageKey],
          (localData: Record<string, HighlightData[]>) => {
            resolve(localData[pageKey] ?? []);
          },
        );
      },
    );
  });
}

/**
 * Removes a single highlight by ID from storage.
 * Deletes the page key entirely when no highlights remain.
 */
export async function removeHighlightById(
  id: string,
  pageKey: string,
): Promise<void> {
  const highlights = await syncGet(pageKey);
  const updated = highlights.filter((h) => h.id !== id);
  if (updated.length === 0) {
    chrome.storage.sync.remove(pageKey);
    chrome.storage.local.remove(pageKey);
  } else {
    await syncSet(pageKey, updated);
  }
}

// ---------------------------------------------------------------------------
// Re-apply highlights
// ---------------------------------------------------------------------------

/**
 * Reapplies a list of highlights using a two-pass approach:
 *
 * Pass 1 — resolve every target node while the DOM is still clean (no spans).
 *           This prevents earlier highlights from blocking later searches, which
 *           would happen when a sentence contains an already-highlighted word
 *           (the TreeWalker skips text inside existing spans).
 *
 * Pass 2 — apply in descending text-length order so outer/longer highlights
 *           are inserted first. Shorter inner highlights then target the same
 *           pre-computed node reference (still valid after surroundContents
 *           moves it inside the outer span) and wrap cleanly inside it.
 */
export function reapplyHighlightsFromStorage(
  highlights: HighlightData[],
  container: HTMLElement = document.body,
): void {
  console.log("Reapplying highlights:", highlights.length);

  removeAllHighlights(container);

  // Pass 1: resolve all targets on the clean DOM
  const targets: Array<{
    item: HighlightData;
    occurrence: { node: Text; startOffset: number; text: string };
  }> = [];

  const skipped: string[] = [];
  for (const item of highlights) {
    try {
      const normalizedText = item.text.trim().replace(/\s+/g, " ");
      const allOccurrences = findAllTextOccurrences(normalizedText);

      if (allOccurrences.length === 0) {
        console.warn(`No occurrences found for "${normalizedText}", skipping`);
        skipped.push(item.id);
        continue;
      }

      const targetIndex = resolveOccurrenceIndex(allOccurrences, item);
      targets.push({ item, occurrence: allOccurrences[targetIndex] });
    } catch (err) {
      console.error(`Error resolving target for highlight:`, err);
      skipped.push(item.id);
    }
  }

  // Pass 2: apply longer highlights first so inner highlights nest correctly
  targets.sort((a, b) => b.item.text.length - a.item.text.length);

  let applied = 0;
  let failed = 0;
  const failedIds: string[] = [];
  for (const { item, occurrence } of targets) {
    try {
      const success = highlightTextNode(
        occurrence.node,
        occurrence.startOffset,
        occurrence.text.length,
        item.color,
        item.id,
      );

      if (!success) {
        console.warn(`Failed to highlight "${item.text}", skipping`);
        failed++;
        failedIds.push(item.id);
      } else {
        applied++;
      }
    } catch (err) {
      console.error(`Error applying highlight for "${item.text}":`, err);
      failed++;
      failedIds.push(item.id);
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7798/ingest/4a22a3f1-86b2-43d8-8539-f9d434bff337',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e78032'},body:JSON.stringify({sessionId:'e78032',runId:'post-fix',hypothesisId:'H9',location:'common.ts:reapplyHighlightsFromStorage',message:'reapply summary',data:{total:highlights.length,resolved:targets.length,skippedCount:skipped.length,skippedIds:skipped,applied,failed,failedIds},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  // Merge any adjacent text nodes left by the DOM manipulations
  container.normalize();
}

/**
 * Picks the best occurrence index for a stored highlight.
 *
 * If context was stored, scores every occurrence and selects the highest.
 * Falls back to pageIndex, then to 0.
 */
export function resolveOccurrenceIndex(
  allOccurrences: { node: Text; startOffset: number; text: string }[],
  item: HighlightData,
): number {
  const hasContext = item.prefixContext !== undefined || item.suffixContext !== undefined;

  if (hasContext) {
    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < allOccurrences.length; i++) {
      const score = scoreOccurrenceByContext(allOccurrences[i], item, i);
      console.log(`Occurrence #${String(i)} context score: ${String(score)}`);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    console.log(
      `Context scoring chose occurrence #${String(bestIndex)} (score: ${String(bestScore)})`,
    );
    return bestIndex;
  }

  // No context — use stored pageIndex with bounds check
  if (
    item.pageIndex !== undefined &&
    item.pageIndex >= 0 &&
    item.pageIndex < allOccurrences.length
  ) {
    return item.pageIndex;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function findAllTextOccurrences(
  text: string,
): { node: Text; startOffset: number; text: string }[] {
  const occurrences: { node: Text; startOffset: number; text: string }[] = [];
  const textToFind = text.trim();

  if (!textToFind) return occurrences;

  const useWordBoundaries =
    !textToFind.includes(" ") && /^[\w-]+$/.test(textToFind);

  const regex = useWordBoundaries
    ? new RegExp(`\\b${escapeRegExp(textToFind)}\\b`, "g")
    : new RegExp(escapeRegExp(textToFind), "g");

  console.log(
    `Using ${useWordBoundaries ? "word boundaries" : "no boundaries"} for search: "${textToFind}"`,
  );

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node: Node): number => {
      const parentNode = node.parentNode;
      if (
        !parentNode ||
        parentNode.nodeName === "STYLE" ||
        parentNode.nodeName === "SCRIPT" ||
        (parentNode instanceof Element &&
          parentNode.classList.contains("custom-highlight")) ||
        !node.textContent ||
        node.textContent.trim() === ""
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      if (!node.textContent.includes(textToFind)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  } as NodeFilter);

  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node instanceof Text) {
      const nodeText = node.textContent ?? "";
      let match: RegExpExecArray | null;
      while ((match = regex.exec(nodeText)) !== null) {
        occurrences.push({
          node: node,
          startOffset: match.index,
          text: match[0],
        });
      }
    }
  }

  return occurrences;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeAllHighlights(container: HTMLElement): void {
  const highlights = container.querySelectorAll(".custom-highlight");
  console.log(`Removing ${String(highlights.length)} existing highlights`);

  highlights.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
    }
  });

  container.normalize();
}


function highlightTextNode(
  node: Text,
  startIndex: number,
  length: number,
  color: string,
  id: string,
): boolean {
  try {
    if (node.nodeValue == null) return false;
    if (startIndex < 0 || startIndex + length > node.length) {
      console.error("Invalid range:", {
        startIndex,
        length,
        nodeLength: node.length,
      });
      return false;
    }

    const range = document.createRange();
    range.setStart(node, startIndex);
    range.setEnd(node, startIndex + length);

    const span = document.createElement("span");
    span.className = "custom-highlight";
    span.id = id;
    span.style.backgroundColor = color;

    try {
      range.surroundContents(span);
      return true;
    } catch (e) {
      console.warn(
        "Range.surroundContents failed, trying alternative approach, error caught: ",
        e,
      );

      try {
        const fragment = range.extractContents();
        span.appendChild(fragment);
        range.insertNode(span);
        return true;
      } catch (e2) {
        console.error("Alternative approach also failed:", e2);
        return false;
      }
    }
  } catch (error) {
    console.error("Error in highlightTextNode:", error);
    return false;
  }
}

export function applyHighlightToTextNode(
  node: Text,
  startIndex: number,
  length: number,
  color: string,
  id: string,
): boolean {
  return highlightTextNode(node, startIndex, length, color, id);
}

function applyFallbackHighlight(
  allOccurrences: { node: Text; startOffset: number; text: string }[],
  item: HighlightData,
): void {
  if (allOccurrences.length > 0) {
    const occurrence = allOccurrences[0];
    const success = highlightTextNode(
      occurrence.node,
      occurrence.startOffset,
      occurrence.text.length,
      item.color,
      item.id,
    );

    if (success) {
      console.log(`Fallback: highlighted first occurrence`);
    }
  } else {
    console.warn(
      `Failed to reapply highlight: "${item.text}" - no occurrences found`,
    );
  }
}
