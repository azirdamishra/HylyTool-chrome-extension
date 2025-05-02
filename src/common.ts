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
    container.normalize(); //merge adjacent text nodes

    // First, clear any existing highlights
    const existingHighlights = container.querySelectorAll('.custom-highlight');
    existingHighlights.forEach(el => {
        const parent = el.parentNode;
        if(parent){
            parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        }
    });
    
    // Normalize again after clearing
    container.normalize();
    
    for(const item of highlights){
        try{
            // First, try with the exact text
            let normalizedTarget = item.text.trim().replace(/\s+/g, ' ');
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
                null
            );

            // Find all matching text nodes and their positions
            let matchingNodes: { node: Text; index: number }[] = [];
            
            // First pass: try to find exact matches
            while(walker.nextNode()){
                const node = walker.currentNode as Text;
                // Skip nodes that are empty or only whitespace
                if(!node.nodeValue || node.nodeValue.trim() === '') continue;
                // Skip nodes that are too small to contain our target
                if(node.nodeValue.length < normalizedTarget.length) continue;
                
                const nodeText = node.nodeValue;
                const idx = nodeText.indexOf(normalizedTarget);
                
                if(idx !== -1){
                    // Check context if available
                    if (item.contextBefore || item.contextAfter) {
                        const beforeContext = idx >= 50 ? nodeText.substring(idx - 50, idx) : nodeText.substring(0, idx);
                        const afterContext = nodeText.substring(idx + normalizedTarget.length, idx + normalizedTarget.length + 50);
                        
                        // If context is specified, make sure it matches
                        if (item.contextBefore && !beforeContext.endsWith(item.contextBefore)) {
                            continue;
                        }
                        if (item.contextAfter && !afterContext.startsWith(item.contextAfter)) {
                            continue;
                        }
                    }
                    
                    matchingNodes.push({ node, index: idx });
                }
            }
            
            // No exact matches found, try with relaxed matching
            if (matchingNodes.length === 0) {
                console.log("No exact matches found for: " + normalizedTarget + ", trying with relaxed matching");
                
                // Try with a more relaxed approach using regex with word boundaries
                const escapedText = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp('\\b' + escapedText + '\\b', 'i'); // case-insensitive, word boundaries
                
                const walker = document.createTreeWalker(
                    container,
                    NodeFilter.SHOW_TEXT,
                    null
                );
                
                while(walker.nextNode()){
                    const node = walker.currentNode as Text;
                    if(!node.nodeValue || node.nodeValue.trim() === '') continue;
                    
                    const nodeText = node.nodeValue;
                    const match = nodeText.match(regex);
                    
                    if(match && match.index !== undefined){
                        matchingNodes.push({ node, index: match.index });
                    }
                }
                
                // If still no matches, split the text and try to find partial matches
                if (matchingNodes.length === 0 && normalizedTarget.includes(' ')) {
                    console.log("Still no matches, trying with partial text");
                    // For phrases, try with just the first few words
                    const words = normalizedTarget.split(' ');
                    if (words.length > 1) {
                        // Try with just the first 2-3 words if it's a long phrase
                        const partialTarget = words.slice(0, Math.min(3, words.length)).join(' ');
                        
                        const walker = document.createTreeWalker(
                            container,
                            NodeFilter.SHOW_TEXT,
                            null
                        );
                        
                        while(walker.nextNode()){
                            const node = walker.currentNode as Text;
                            if(!node.nodeValue || node.nodeValue.trim() === '') continue;
                            
                            const nodeText = node.nodeValue;
                            const idx = nodeText.indexOf(partialTarget);
                            
                            if(idx !== -1){
                                matchingNodes.push({ node, index: idx });
                                // Adjust highlight length to only cover what was found
                                normalizedTarget = partialTarget;
                            }
                        }
                    }
                }
            }
            
            // No matches found after all attempts
            if (matchingNodes.length === 0) {
                console.warn("Failed to reapply highlight: ", item.text);
                continue;
            }
            
            // If position is specified, use that occurrence
            let targetNode, targetIndex;
            if (item.position !== undefined && item.position < matchingNodes.length) {
                const match = matchingNodes[item.position];
                targetNode = match.node;
                targetIndex = match.index;
            } else {
                // Default to the first occurrence if no position or position is out of range
                const match = matchingNodes[0];
                targetNode = match.node;
                targetIndex = match.index;
            }
            
            const success = applyHighlightToTextNode(targetNode, targetIndex, normalizedTarget.length, item.color, item.id);
            if(success){
                console.log("Reapplied highlight: ", item.id, " with color ", item.color);
            } else {
                console.warn("Failed to apply highlight: ", item.text);
            }
        }
        catch(err){
            console.error("Error reapplying highlight: ", err);
        }
    }
}


/**
 * Highlights a given substring within a text node using DOM node splitting 
 * @returns true if highlight applied, false if not applied
 * 
 * @param node - The Text node containing the match
 * @param startIndex - The start index of the text to highlight
 * @param length - The length of the text to highlight
 * @param color - Highlight background color (eg: '#ffff00)
 * @param id - A unique ID to assign to the span (eg. 'highlight-xyz')
 */

export function applyHighlightToTextNode(
    node: Text,
    startIndex: number,
    length: number,
    color: string,
    id: string
): boolean {
    try {
        // Ensure the indices are valid
        if (startIndex < 0 || startIndex + length > node.length) {
            console.error("Invalid range:", {startIndex, length, nodeLength: node.length});
            return false;
        }
        
        // Create a range for the matching text
        const range = document.createRange();
        range.setStart(node, startIndex);
        range.setEnd(node, startIndex + length);
        
        // Create the highlight span
        const span = document.createElement('span');
        span.className = 'custom-highlight';
        span.id = id;
        span.style.backgroundColor = color;
        
        try {
            // Wrap the matching text in the span
            range.surroundContents(span);
            return true;
        } catch (e) {
            console.error("Failed to surround contents:", e);
            
            // Try an alternative approach
            try {
                const fragment = range.extractContents();
                span.appendChild(fragment);
                range.insertNode(span);
                return true;
            } catch (e2) {
                console.error("Failed alternative approach:", e2);
                return false;
            }
        }
    } catch (error) {
        console.error("Error applying highlight:", error);
        return false;
    }
}