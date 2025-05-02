export function setBadgeText(enabled: boolean){
    const text = enabled ? "ON": "OFF"
    void chrome.action.setBadgeText({text: text})
}

export interface HighlightData{
    id: string;
    text: string;
    color: string;
    position?: number;
    contextBefore?: string;
    contextAfter?: string;
}

/**
 * Reapplies a list of highlights by searching all text nodes using a TreeWalker.
 * @param highlights - Array of highlight data objects
 * @param container - DOM element to search within (defaults to document.body)
 */

export function reapplyHighlightsFromStorage(
    highlights: HighlightData[],
    container: HTMLElement = document.body
): void {
    console.log("Reapplying highlights:", highlights);
    
    // First, clear any existing highlights
    removeAllHighlights(container);
    
    // Create a single DOM walker to improve performance
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
    );
    
    // Collect all text nodes once (performance optimization)
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.nodeValue && node.nodeValue.trim() !== '') {
            textNodes.push(node);
        }
    }
    
    console.log(`Found ${textNodes.length} text nodes in document`);
    
    // Process highlights in order
    for (const item of highlights) {
        try {
            const normalizedText = item.text.trim().replace(/\s+/g, ' ');
            console.log(`Processing highlight: "${normalizedText}" (ID: ${item.id})`);
            
            // Track if we successfully applied this highlight
            let applied = false;
            
            // 1. Try exact match with position information
            if (item.position !== undefined) {
                console.log(`Trying exact match with position ${item.position}`);
                const matches = findTextMatches(textNodes, normalizedText, false);
                
                if (matches.length > item.position) {
                    const match = matches[item.position];
                    applied = highlightTextNode(match.node, match.index, normalizedText.length, item.color, item.id);
                    
                    if (applied) {
                        console.log(`Successfully applied highlight at position ${item.position}`);
                        continue; // Move to next highlight
                    }
                }
            }
            
            // 2. Try context-based matching
            if (!applied && (item.contextBefore || item.contextAfter)) {
                console.log('Trying context-based matching');
                const matches = findTextMatches(textNodes, normalizedText, false);
                
                // Find best context match
                let bestMatchIndex = -1;
                let bestScore = -1;
                
                for (let i = 0; i < matches.length; i++) {
                    const match = matches[i];
                    const nodeText = match.node.nodeValue || '';
                    let score = 0;
                    
                    // Check context before
                    if (item.contextBefore) {
                        const before = match.index >= item.contextBefore.length ? 
                            nodeText.substring(match.index - item.contextBefore.length, match.index) : 
                            nodeText.substring(0, match.index);
                            
                        if (before.endsWith(item.contextBefore)) {
                            score += 2;
                        } else if (before.includes(item.contextBefore)) {
                            score += 1;
                        }
                    }
                    
                    // Check context after
                    if (item.contextAfter) {
                        const after = match.index + normalizedText.length + item.contextAfter.length <= nodeText.length ?
                            nodeText.substring(match.index + normalizedText.length, match.index + normalizedText.length + item.contextAfter.length) :
                            nodeText.substring(match.index + normalizedText.length);
                            
                        if (after.startsWith(item.contextAfter)) {
                            score += 2;
                        } else if (after.includes(item.contextAfter)) {
                            score += 1;
                        }
                    }
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatchIndex = i;
                    }
                }
                
                if (bestMatchIndex !== -1) {
                    const match = matches[bestMatchIndex];
                    applied = highlightTextNode(match.node, match.index, normalizedText.length, item.color, item.id);
                    
                    if (applied) {
                        console.log(`Successfully applied highlight with context match (score: ${bestScore})`);
                        continue; // Move to next highlight
                    }
                }
            }
            
            // 3. Try case-insensitive match for single words
            if (!applied && !normalizedText.includes(' ')) {
                console.log('Trying case-insensitive match for single word');
                const matches = findTextMatches(textNodes, normalizedText, true);
                
                if (matches.length > 0) {
                    const match = matches[0]; // Use the first match
                    applied = highlightTextNode(match.node, match.index, match.length, item.color, item.id);
                    
                    if (applied) {
                        console.log('Successfully applied highlight with case-insensitive match');
                        continue; // Move to next highlight
                    }
                }
            }
            
            // 4. For phrases, try partial matching
            if (!applied && normalizedText.includes(' ')) {
                console.log('Trying partial match for phrase');
                const words = normalizedText.split(' ');
                
                // Try with decreasing number of words
                for (let wordCount = words.length - 1; wordCount >= 1; wordCount--) {
                    const partialText = words.slice(0, wordCount).join(' ');
                    console.log(`Trying with partial text: "${partialText}"`);
                    
                    const matches = findTextMatches(textNodes, partialText, false);
                    
                    if (matches.length > 0) {
                        const match = matches[0]; // Use the first match
                        applied = highlightTextNode(match.node, match.index, partialText.length, item.color, item.id);
                        
                        if (applied) {
                            console.log(`Successfully applied highlight with partial text "${partialText}"`);
                            break; // Exit the for loop
                        }
                    }
                }
                
                if (applied) continue; // Move to next highlight
            }
            
            // 5. Last resort: try with first word only for phrases
            if (!applied && normalizedText.includes(' ')) {
                console.log('Trying with first word only');
                const firstWord = normalizedText.split(' ')[0];
                const matches = findTextMatches(textNodes, firstWord, true);
                
                if (matches.length > 0) {
                    const match = matches[0]; // Use the first match
                    applied = highlightTextNode(match.node, match.index, match.length, item.color, item.id);
                    
                    if (applied) {
                        console.log(`Successfully applied highlight with first word "${firstWord}"`);
                        continue; // Move to next highlight
                    }
                }
            }
            
            if (!applied) {
                console.warn(`Failed to reapply highlight: "${normalizedText}"`);
            }
        } 
        catch (err) {
            console.error(`Error reapplying highlight:`, err);
        }
    }
    
    // Final cleanup - remove any nested highlights and normalize DOM
    cleanupHighlights(container);
}

/**
 * Find all occurrences of text in text nodes.
 * @param textNodes Array of text nodes to search
 * @param searchText Text to search for
 * @param caseInsensitive Whether to do case-insensitive matching
 * @returns Array of matches with node, index and length
 */
function findTextMatches(
    textNodes: Text[], 
    searchText: string,
    caseInsensitive: boolean
): Array<{ node: Text; index: number; length: number }> {
    const matches: Array<{ node: Text; index: number; length: number }> = [];
    
    for (const node of textNodes) {
        const nodeText = node.nodeValue || '';
        
        if (caseInsensitive) {
            // Case-insensitive search
            const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            let match;
            
            while ((match = regex.exec(nodeText)) !== null) {
                matches.push({ 
                    node, 
                    index: match.index, 
                    length: match[0].length 
                });
            }
        } else {
            // Case-sensitive exact search
            let position = 0;
            let index = nodeText.indexOf(searchText, position);
            
            while (index !== -1) {
                matches.push({ 
                    node, 
                    index, 
                    length: searchText.length 
                });
                position = index + searchText.length;
                index = nodeText.indexOf(searchText, position);
            }
        }
    }
    
    return matches;
}

/**
 * Remove all highlights from the container
 */
function removeAllHighlights(container: HTMLElement): void {
    const highlights = container.querySelectorAll('.custom-highlight');
    console.log(`Removing ${highlights.length} existing highlights`);
    
    highlights.forEach(el => {
        const parent = el.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(el.textContent || ''), el);
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
    const highlights = container.querySelectorAll('.custom-highlight');
    highlights.forEach(highlight => {
        const nestedHighlights = highlight.querySelectorAll('.custom-highlight');
        if (nestedHighlights.length > 0) {
            console.warn('Found nested highlights - fixing');
            nestedHighlights.forEach(nested => {
                const text = nested.textContent || '';
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
    id: string
): boolean {
    try {
        // Validate parameters
        if (!node || !node.nodeValue) return false;
        if (startIndex < 0 || startIndex + length > node.length) {
            console.error('Invalid range:', {startIndex, length, nodeLength: node.length});
            return false;
        }
        
        // Create range
        const range = document.createRange();
        range.setStart(node, startIndex);
        range.setEnd(node, startIndex + length);
        
        // Create span
        const span = document.createElement('span');
        span.className = 'custom-highlight';
        span.id = id;
        span.style.backgroundColor = color;
        
        try {
            // Main approach: surroundContents
            range.surroundContents(span);
            return true;
        } catch (e) {
            console.warn('Range.surroundContents failed, trying alternative approach');
            
            try {
                // Alternative 1: extract and insert
                const fragment = range.extractContents();
                span.appendChild(fragment);
                range.insertNode(span);
                return true;
            } catch (e2) {
                console.error('Alternative approach also failed:', e2);
                return false;
            }
        }
    } catch (error) {
        console.error('Error in highlightTextNode:', error);
        return false;
    }
}

export function applyHighlightToTextNode(
    node: Text,
    startIndex: number,
    length: number,
    color: string,
    id: string
): boolean {
    return highlightTextNode(node, startIndex, length, color, id);
}