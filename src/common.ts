export function setBadgeText(enabled: boolean) {
  const text = enabled ? "ON" : "OFF";
  void chrome.action.setBadgeText({ text: text });
}

export interface HighlightData {
  id: string;
  text: string;
  color: string;
  // Simple global page index
  pageIndex?: number;
  totalInstances?: number;
}

/**
 * Reapplies a list of highlights by searching all text nodes using a TreeWalker.
 * @param highlights - Array of highlight data objects
 * @param container - DOM element to search within (defaults to document.body)
 */

export function reapplyHighlightsFromStorage(
  highlights: HighlightData[],
  container: HTMLElement = document.body,
): void {
  console.log("Reapplying highlights:", highlights.length);

  // First, clear any existing highlights
  removeAllHighlights(container);

  // Process highlights one by one with a small delay between them
  processNextHighlight(highlights, 0, container);

  // Final cleanup
  setTimeout(
    () => {
      cleanupHighlights(container);
    },
    highlights.length * 100 + 100,
  );
}

/**
 * Process highlights one by one with a small delay
 */
function processNextHighlight(
  highlights: HighlightData[],
  index: number,
  container: HTMLElement,
): void {
  if (index >= highlights.length) return;

  const item = highlights[index];

  try {
    const normalizedText = item.text.trim().replace(/\s+/g, " ");
    console.log(`Processing highlight: "${normalizedText}" (ID: ${item.id})`);

    // Find all occurrences of this text on the page
    const allOccurrences: {
      node: Text;
      startOffset: number;
      text: string;
    }[] = findAllTextOccurrences(normalizedText);

    console.log(
      `Found ${allOccurrences.length} occurrences of "${normalizedText}"`,
    );

    // Use the stored page index if available
    if (
      item.pageIndex !== undefined &&
      item.pageIndex >= 0 &&
      item.pageIndex < allOccurrences.length
    ) {
      const occurrence = allOccurrences[item.pageIndex];

      // Double check with console log
      console.log(
        `Targeting specific occurrence #${item.pageIndex} at node:`,
        occurrence.node,
        "offset:",
        occurrence.startOffset,
      );
      console.log(`Occurrence text: "${occurrence.text.substring(0, 20)}..."`);
      console.log(`Occurrence parent: ${occurrence.node.parentNode?.nodeName}`);
      console.log(
        `Occurrence siblings: ${occurrence.node.parentNode?.childNodes.length}`,
      );

      // Add visual indicator to verify we're getting the right position
      if (!normalizedText.includes(" ")) {
        // For debugging - highlight each occurrence briefly in red before applying the actual highlight
        for (let i = 0; i < allOccurrences.length; i++) {
          const occ = allOccurrences[i];
          try {
            // Create a temporary range and style
            const tempRange = document.createRange();
            tempRange.setStart(occ.node, occ.startOffset);
            tempRange.setEnd(occ.node, occ.startOffset + occ.text.length);

            // Create a small indicator span to show the index
            const indexSpan = document.createElement("span");
            indexSpan.style.fontSize = "9px";
            indexSpan.style.position = "absolute";
            indexSpan.style.backgroundColor =
              i === item.pageIndex ? "green" : "red";
            indexSpan.style.color = "white";
            indexSpan.style.padding = "2px";
            indexSpan.style.zIndex = "9999";
            indexSpan.textContent = `#${i}`;
            document.body.appendChild(indexSpan);

            // Position it near the occurrence
            const tempSpan = document.createElement("span");
            const clonedContents = tempRange.cloneContents();
            tempSpan.appendChild(clonedContents);
            tempSpan.style.position = "absolute";
            tempSpan.style.visibility = "hidden";
            document.body.appendChild(tempSpan);
            const rect = tempSpan.getBoundingClientRect();
            document.body.removeChild(tempSpan);

            indexSpan.style.top = `${window.scrollY + rect.top - 15}px`;
            indexSpan.style.left = `${window.scrollX + rect.left}px`;

            // Remove after a few seconds
            setTimeout(() => {
              if (indexSpan.parentNode) {
                indexSpan.parentNode.removeChild(indexSpan);
              }
            }, 3000);
          } catch (e) {
            console.error("Error showing debug indicator:", e);
          }
        }
      }

      // Add a small delay to let the visual indicators appear first
      setTimeout(() => {
        const success = highlightTextNode(
          occurrence.node,
          occurrence.startOffset,
          occurrence.text.length,
          item.color,
          item.id,
        );

        if (success) {
          console.log(`Successfully highlighted occurrence #${item.pageIndex}`);
        } else {
          console.warn(
            `Failed to highlight occurrence #${item.pageIndex}, will try fallback`,
          );
          applyFallbackHighlight(allOccurrences, item);
        }

        // Process next highlight
        setTimeout(() => {
          processNextHighlight(highlights, index + 1, container);
        }, 50);
      }, 50);
    } else {
      applyFallbackHighlight(allOccurrences, item);

      // Process next highlight
      setTimeout(() => {
        processNextHighlight(highlights, index + 1, container);
      }, 50);
    }
  } catch (err) {
    console.error(`Error reapplying highlight:`, err);

    // Even if error, process next highlight
    setTimeout(() => {
      processNextHighlight(highlights, index + 1, container);
    }, 50);
  }
}

/**
 * Find all occurrences of text on the page
 */
function findAllTextOccurrences(
  text: string,
): { node: Text; startOffset: number; text: string }[] {
  const occurrences: { node: Text; startOffset: number; text: string }[] = [];
  const textToFind = text.trim();

  // If text is empty, return empty array
  if (!textToFind) return occurrences;

  // Determine if we need word boundaries based on content
  // Only use word boundaries for single words without special characters
  const useWordBoundaries =
    !textToFind.includes(" ") && /^[\w-]+$/.test(textToFind);

  // Create regex with or without word boundaries
  const regex = useWordBoundaries
    ? new RegExp(`\\b${escapeRegExp(textToFind)}\\b`, "g")
    : new RegExp(escapeRegExp(textToFind), "g");

  console.log(
    `Using ${useWordBoundaries ? "word boundaries" : "no boundaries"} for search: "${textToFind}"`,
  );

  // Walk through all text nodes in the document
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node: Node): number => {
        // Skip style, script, and empty text nodes
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

        // Skip nodes that don't contain our text
        if (!node.textContent.includes(textToFind)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    } as NodeFilter,
  );

  // Go through each text node and find all occurrences
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

// Helper function to escape special regex characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove all highlights from the container
 */
function removeAllHighlights(container: HTMLElement): void {
  const highlights = container.querySelectorAll(".custom-highlight");
  console.log(`Removing ${highlights.length} existing highlights`);

  highlights.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
    }
  });

  // Normalize DOM to merge adjacent text nodes
  container.normalize();
}

/**
 * Clean up any nested highlights or invalid DOM structures
 */
function cleanupHighlights(container: HTMLElement): void {
  // Normalize DOM to merge adjacent text nodes
  container.normalize();

  // Find and fix any nested highlights
  const highlights = container.querySelectorAll(".custom-highlight");
  highlights.forEach((highlight) => {
    const nestedHighlights = highlight.querySelectorAll(".custom-highlight");
    if (nestedHighlights.length > 0) {
      console.warn("Found nested highlights - fixing");
      nestedHighlights.forEach((nested) => {
        const text = nested.textContent ?? "";
        nested.parentNode?.replaceChild(document.createTextNode(text), nested);
      });
    }
  });
}

/**
 * Highlights a given substring within a text node
 * @returns true if highlight applied, false if not applied
 */
function highlightTextNode(
  node: Text,
  startIndex: number,
  length: number,
  color: string,
  id: string,
): boolean {
  try {
    // Validate parameters
    if (node?.nodeValue == null) return false;
    if (startIndex < 0 || startIndex + length > node.length) {
      console.error("Invalid range:", {
        startIndex,
        length,
        nodeLength: node.length,
      });
      return false;
    }

    // Create range
    const range = document.createRange();
    range.setStart(node, startIndex);
    range.setEnd(node, startIndex + length);

    // Create span
    const span = document.createElement("span");
    span.className = "custom-highlight";
    span.id = id;
    span.style.backgroundColor = color;

    try {
      // Main approach: surroundContents
      range.surroundContents(span);
      return true;
    } catch (e) {
      console.warn(
        "Range.surroundContents failed, trying alternative approach, error caught: ",
        e,
      );

      try {
        // Alternative 1: extract and insert
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

// Helper function to apply fallback highlight
function applyFallbackHighlight(
  allOccurrences: { node: Text; startOffset: number; text: string }[],
  item: HighlightData,
): void {
  // Fallback: use the first occurrence
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
