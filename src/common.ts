export function setBadgeText(enabled: boolean){
    const text = enabled ? "ON": "OFF"
    void chrome.action.setBadgeText({text: text})
}

export interface HighlightData{
    id: string;
    text: string;
    color: string;
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
            const normalizedTarget = item.text.trim().replace(/\s+/g, ' ');
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
                null
            );

            let applied = false;
            while(walker.nextNode()){
                const node = walker.currentNode as Text;
                // Skip nodes that are empty or only whitespace
                if(!node.nodeValue || node.nodeValue.trim() === '') continue;
                // Skip nodes that are too small to contain our target
                if(node.nodeValue.length < normalizedTarget.length) continue;
                
                const nodeText = node.nodeValue.trim().replace(/\s+/g, ' ');

                if(nodeText.includes(normalizedTarget)){
                    const success = applyHighlightToTextNode(node, normalizedTarget, item.color, item.id);
                    if(success){
                        console.log("Reapplied highlight: ", item.id, " with color ", item.color);
                        applied = true;
                        break;
                    }
                }
            }
            
            if(!applied){
                console.warn("Failed to reapply highlight: ", item.text);
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
 * @param node - The Text node contianing the match
 * @param matchText - The exact text to highlight
 * @param color - Highlight background color (eg: '#ffff00)
 * @param id - A unique ID to assign to the span (eg. 'highlight-xyz')
 */

export function applyHighlightToTextNode(
    node: Text,
    matchText: string,
    color: string,
    id: string
): boolean {
    
    // const nodeText = node.textContent || '';
    // // const idx = nodeText.indexOf(matchText);
    // // if(idx === -1) return false;
    // //Use regex to find match more robustl (case-insensitive)
    // const regex = new RegExp(matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    // const match = nodeText.match(regex);
    // if(!match || match.index === undefined) {
    //     console.warn("Text match failed: ", {matchText, nodeText});
    //     return false;
    // }

    // const idx = match.index;
    // const before = nodeText.substring(0, idx);
    // //const match = nodeText.substring(idx, idx + matchText.length);
    // const foundMatch = nodeText.substring(idx + match[0].length);
    // const after = nodeText.substring(idx + matchText.length);

    // const beforeNode = document.createTextNode(before);
    // const afterNode = document.createTextNode(after);

    // const span = document.createElement('span');
    // span.textContent = foundMatch;
    // span.style.backgroundColor = color;
    // span.className = 'custom-highlight';
    // span.id = id;

    // const parent = node.parentNode;
    // if(!parent) return false;

    // //Replace original text node with: before + highlight + after
    // parent.replaceChild(afterNode, node);
    // parent.insertBefore(span, afterNode);
    // parent.insertBefore(beforeNode, span);

    // return true;

    try {
        const nodeText = node.textContent || '';
        const idx = nodeText.indexOf(matchText);
        if(idx === -1) return false;
        
        // Create a range for the matching text
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + matchText.length);
        
        // Create the highlight span
        const span = document.createElement('span');
        span.className = 'custom-highlight';
        span.id = id;
        span.style.backgroundColor = color;
        
        // Wrap the matching text in the span
        range.surroundContents(span);
        
        return true;
    } catch (error) {
        console.error("Error applying highlight:", error);
        return false;
    }

}