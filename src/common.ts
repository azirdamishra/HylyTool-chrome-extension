export function setBadgeText(enabled: boolean){
    const text = enabled ? "ON": "OFF"
    void chrome.action.setBadgeText({text: text})
}

/**
 * Applies a highlight to a given text node, replacing target text with a highlighted span
 * This avoids the fragility of surroundContents by safely splitting the node
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
    
    const nodeText = node.textContent || '';
    const idx = nodeText.indexOf(matchText);
    if(idx === -1) return false;

    const before = nodeText.substring(0, idx);
    const match = nodeText.substring(idx, idx + matchText.length);
    const after = nodeText.substring(idx + matchText.length)

    const beforeNode = document.createTextNode(before)
    const afterNode = document.createTextNode(after);

    const span = document.createElement('span');
    span.textContent = match;
    span.style.backgroundColor = color;
    span.className = 'custom-highlight';
    span.id = id;

    const parent = node.parentNode;
    if(!parent) return false;

    //Replace original text node with: before + highlight + after
    parent.replaceChild(afterNode, node);
    parent.insertBefore(span, afterNode);
    parent.insertBefore(beforeNode, span);

    return true;

}