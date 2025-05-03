"use strict";
import { applyHighlightToTextNode, reapplyHighlightsFromStorage } from "./common";
import { HighlightData } from './common';

const blurFilter = "blur(6px)"
let textToBlur = ""

//Search the DOM node for text to blur and blur only the specific text
function processNode(node: Node){
    if(node.childNodes.length > 0){
        Array.from(node.childNodes).forEach(processNode)
    }
    if(node.nodeType === Node.TEXT_NODE && 
        node.textContent !== null &&
        node.textContent.trim().length > 0){
            const parent = node.parentElement
            if(parent == null) return
            if(parent != null &&
                (parent.tagName === 'SCRIPT' || parent.style.filter === blurFilter)
            ){
                //Already blurred
                return
            }
            if (node.textContent.includes(textToBlur)){
                // Create a document fragment to hold our modified content
                const fragment = document.createDocumentFragment();
                
                // Split the text by the blurred portion
                const parts = node.textContent.split(textToBlur);
                
                //Rebuild the content with blurred spans in the correct positions
                for(let i = 0; i < parts.length; i++){
                    //Add the regular text part
                    if(parts[i]){
                        fragment.appendChild(document.createTextNode(parts[i]));
                    }

                    //Add the blurred span (except after the last part)
                    if(i < parts.length - 1){
                        const blurSpan = document.createElement('span');
                        blurSpan.style.filter = blurFilter;
                        blurSpan.style.display = 'inline';
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

function blurElement(elem: HTMLElement) {
    elem.style.filter = blurFilter
    console.debug("blurred id:" + elem.id + " class:" + elem.className +
        " tag:" + elem.tagName + " text:" + elem.textContent)
}

//Create a MutationObserver to watch for changes to the DOM
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if(mutation.addedNodes.length > 0){
            mutation.addedNodes.forEach(processNode)
        }else{
            processNode(mutation.target)
        }
    })
})

//Enable the content script by default
let enabled = true;
let highlightMode = false;
let highlightColor = '#FFFF00';
const keys = ["enabled", "item"];

console.log("Content script initialized");

//Only start observing the DOM if the extension is enabled and there is text to blur
function observe(){
    if(enabled && textToBlur.trim().length > 0)
    {
        observer.observe(document, {
            attributes: false,
            characterData: true,
            childList: true,
            subtree: true
        })

        processNode(document);
    } else {
        console.log("Not starting observation because:", {
            enabled,
            hasText: textToBlur.trim().length > 0
        });
    }
}

chrome.storage.sync.get(keys, (data) => {
    console.log("Storage data received:", data);
    
    if(data.enabled === false){
        enabled = false
        console.log("Extension disabled");
    }
    if(data.item){
        textToBlur = data.item
        console.log("Text to blur set to:", textToBlur);
    }

    observe();
})


//highlighting text
chrome.storage.local.get(['highlightMode', 'highlightColor'], (data) => {
    console.log('Initial highlight mode state:', data);
    highlightMode = !!data.highlightMode;
    if (data.highlightColor) {
        highlightColor = data.highlightColor;
    }
    
    if(highlightMode && enabled){
        console.log('Setting up highlight event listener');
        document.addEventListener('mouseup', handleMouseUp);
    }
});

// Handle mouseup event for highlighting
function handleMouseUp() {
    if (!highlightMode || !enabled) return;
    
    const selection = window.getSelection();
    if(selection && selection.toString()){
        console.log('Selection made:', selection.toString());
        addHighlight();
    }
}

// Update highlightMode when it changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.highlightMode) {
            highlightMode = !!changes.highlightMode.newValue;
            console.log('Highlight mode changed to:', highlightMode);
            
            // Add or remove event listener based on new value
            if (highlightMode && enabled) {
                document.removeEventListener('mouseup', handleMouseUp);
                document.addEventListener('mouseup', handleMouseUp);
            } else {
                document.removeEventListener('mouseup', handleMouseUp);
            }
        }
        
        if (changes.highlightColor) {
            highlightColor = changes.highlightColor.newValue;
            console.log('Highlight color changed to:', highlightColor);
        }
    }
});

//on every page load, the content script checks for existing highlights in chrome storage and reapplies them
window.addEventListener('load', () => {
    if(!enabled) return;//Don't show highlights if extension is disabled

    const pageKey = window.location.href;
    console.log('Loading highlights for page:', pageKey);
    chrome.storage.local.get([pageKey], (data) => {
        const highlights = data[pageKey] || [];
        console.log('Found highlights:', highlights);
        reapplyHighlightsFromStorage(highlights);
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extensionStateChanged') {
        console.log("Received extension state change: ", request.enabled);
        enabled = request.enabled;
        const pageKey = window.location.href;
        
        if (enabled) {
            // Show all highlights when extension is enabled
            chrome.storage.local.get([pageKey], (data) => {
                const highlights = data[pageKey] || [];
                console.log('Reapplying highlights:', highlights);
                reapplyHighlightsFromStorage(highlights);
            });
        } else {
            // Remove all highlights when extension is disabled
            const highlights = document.querySelectorAll('.custom-highlight');
            highlights.forEach(el => {
                const parent = el.parentNode;
                if (parent) {
                    parent.replaceChild(document.createTextNode(el.textContent || ''), el);
                }
            });
            // Normalize the document to clean up text nodes
            document.body.normalize();
            console.log('Removed highlights from DOM');
        } 

    } else if(request.action === 'applyBlur'){
        //Update the text to blur
        textToBlur = request.text;
        console.log("Applying blur to text: ", textToBlur);

        //Process the document with the new text to blur
        if(enabled && textToBlur){
            //Remove existing blur before applying new
            removeAllBlurredElements();
            //Apply the new blur
            processNode(document);
            console.log("Blur applied without page reload");
        }

        //Send response back
        sendResponse({success: true});

    } else if(request.action === 'removeBlur'){
        //Clear the text to blur
        textToBlur = "";
        console.log("Removing the blur effects");

        //Remove all blur effects
        removeAllBlurredElements();
        
        //Send response back
        sendResponse({success: true});
    }
});

/**
 * Finds the occurrence position (0-based) of a text string in a text node
 * @param node The text node
 * @param text The text to find
 * @returns The occurrence position (0 for first, 1 for second, etc.)
 */
function findOccurrencePosition(node: Text, text: string): number {
    const fullText = node.textContent || '';
    let position = 0;
    let lastIndex = 0;
    
    // Set the initial index to the start of the text node
    const selectedIndex = fullText.indexOf(text);
    
    // Count the occurrences before the selected text
    while(lastIndex < selectedIndex && lastIndex !== -1) {
        lastIndex = fullText.indexOf(text, lastIndex + 1);
        if(lastIndex !== -1 && lastIndex < selectedIndex) {
            position++;
        }
    }
    
    return position;
}

/**
 * Adds a highlight to the current selection
 */
function addHighlight() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    const selectedText = range.toString().trim();
    if (!selectedText) return;

    // Clean and limit the text length
    const cleanedText = selectedText.length > 100 
        ? selectedText.substring(0, 100) 
        : selectedText;
    
    // Use the global highlightColor or get the next color in rotation
    const color = highlightColor || getNextHighlightColor();
    
    // Find all occurrences of this text on the page
    const allOccurrences = findAllTextOccurrences(cleanedText);
    console.log(`Found ${allOccurrences.length} occurrences of "${cleanedText}" on the page`);
    
    // The selection range gives us exact information about the current selection
    const currentNode = range.startContainer;
    const currentOffset = range.startOffset;
    
    // Find which occurrence matches our current selection by comparing node and offset
    let matchingIndex = -1;
    
    console.log('Current selection node:', currentNode, 'offset:', currentOffset);
    
    // Match based on exact node and approximate offset
    for (let i = 0; i < allOccurrences.length; i++) {
        const occurrence = allOccurrences[i];
        
        // Check if this is our exact node
        if (occurrence.node === currentNode) {
            // For single offset match, check if offset is within a small range of error
            const offsetDiff = Math.abs(occurrence.startOffset - currentOffset);
            
            console.log(`Checking occurrence #${i} - node match: true, offset: ${occurrence.startOffset}, diff: ${offsetDiff}`);
            
            // If offset is exact or within a small error margin (sometimes selection offsets can be off by a character or two)
            if (offsetDiff <= 5) {
                matchingIndex = i;
                console.log(`Found exact match at occurrence #${matchingIndex}`);
                break;
            }
        }
    }
    
    // If we still don't have a match, try to find the occurrence that contains our selection
    if (matchingIndex === -1) {
        for (let i = 0; i < allOccurrences.length; i++) {
            const occurrence = allOccurrences[i];
            
            // Check if the node contains our selection's start node
            if (occurrence.node.contains && occurrence.node.contains(currentNode)) {
                console.log(`Occurrence #${i} contains our selection node`);
                
                // Calculate total offset to see if our selection falls within this occurrence
                try {
                    const rangeToOccurrence = document.createRange();
                    rangeToOccurrence.setStart(occurrence.node, 0);
                    rangeToOccurrence.setEnd(currentNode, currentOffset);
                    
                    // Check if the selection falls within the range of this occurrence
                    const offsetFromParent = rangeToOccurrence.toString().length;
                    
                    if (offsetFromParent >= occurrence.startOffset && 
                        offsetFromParent < (occurrence.startOffset + occurrence.text.length)) {
                        matchingIndex = i;
                        console.log(`Found containing match at occurrence #${matchingIndex} by offset calculation`);
                        break;
                    }
                } catch (e) {
                    console.error('Error calculating offsets:', e);
                }
            }
        }
    }
    
    // If still no match, use most visual approach - find the occurrence closest to the current viewport position
    if (matchingIndex === -1) {
        try {
            const selectionRect = range.getBoundingClientRect();
            let closestDistance = Infinity;
            
            for (let i = 0; i < allOccurrences.length; i++) {
                const occurrence = allOccurrences[i];
                
                // Create a temporary range for this occurrence to get its position
                const occRange = document.createRange();
                occRange.setStart(occurrence.node, occurrence.startOffset);
                occRange.setEnd(occurrence.node, occurrence.startOffset + occurrence.text.length);
                
                const occRect = occRange.getBoundingClientRect();
                
                // Calculate distance between centers of the rectangles
                const selectionCenterX = selectionRect.left + selectionRect.width / 2;
                const selectionCenterY = selectionRect.top + selectionRect.height / 2;
                const occCenterX = occRect.left + occRect.width / 2;
                const occCenterY = occRect.top + occRect.height / 2;
                
                const distance = Math.sqrt(
                    Math.pow(selectionCenterX - occCenterX, 2) + 
                    Math.pow(selectionCenterY - occCenterY, 2)
                );
                
                console.log(`Occurrence #${i} visual distance: ${distance}`);
                
                if (distance < closestDistance) {
                    closestDistance = distance;
                    matchingIndex = i;
                }
            }
            
            console.log(`Found closest visual match at occurrence #${matchingIndex} with distance ${closestDistance}`);
        } catch (e) {
            console.error('Error calculating visual distances:', e);
        }
    }
    
    // If all else fails, default to the first occurrence
    if (matchingIndex === -1) {
        console.warn('Could not determine occurrence index, defaulting to first occurrence');
        matchingIndex = 0;
    }
    
    console.log(`Selected occurrence index: ${matchingIndex} out of ${allOccurrences.length} total`);
    
    // Create a new unique ID for this highlight
    const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Highlight the range with the assigned color
    const highlightElement = document.createElement('span');
    highlightElement.className = 'custom-highlight';
    highlightElement.id = highlightId;
    highlightElement.style.backgroundColor = color;
    
    try {
        range.surroundContents(highlightElement);
        
        // Store the highlight data with page index
        const highlightData: HighlightData = {
            id: highlightId,
            text: cleanedText,
            color: color,
            pageIndex: matchingIndex,
            totalInstances: allOccurrences.length
        };
        
        // Save to storage using page URL as key
        const pageKey = window.location.href;
        chrome.storage.local.get([pageKey], (result) => {
            const highlights = result[pageKey] || [];
            highlights.push(highlightData);
            
            chrome.storage.local.set({ [pageKey]: highlights }, () => {
                console.log('Highlight saved with ID:', highlightId, 'data:', highlightData);
            });
        });
    } catch (e) {
        console.error('Error applying highlight:', e);
    }
}

// Helper function to get the next color from the rotation
function getNextHighlightColor(): string {
    const highlightColors = [
        '#FFFF00', // Yellow
        '#7FFFD4', // Aquamarine
        '#FF69B4', // Hot Pink
        '#FFA500', // Orange
        '#00FFFF'  // Cyan
    ];
    
    // Get the current index from storage or use 0 as default
    let currentColorIndex = parseInt(localStorage.getItem('currentColorIndex') || '0');
    
    // Get the color to use
    const color = highlightColors[currentColorIndex];
    
    // Update the index for next time
    currentColorIndex = (currentColorIndex + 1) % highlightColors.length;
    localStorage.setItem('currentColorIndex', currentColorIndex.toString());
    
    return color;
}

// Helper function to find all text occurrences on the page
function findAllTextOccurrences(text: string): Array<{node: Text, startOffset: number, text: string}> {
    const occurrences: Array<{node: Text, startOffset: number, text: string}> = [];
    const textToFind = text.trim();
    
    // If text is empty, return empty array
    if (!textToFind) return occurrences;
    
    // Determine if we need word boundaries based on content
    // Only use word boundaries for single words without special characters
    const useWordBoundaries = !textToFind.includes(' ') && 
                             /^[\w\-]+$/.test(textToFind);
    
    // Create regex with or without word boundaries
    const regex = useWordBoundaries ? 
        new RegExp(`\\b${escapeRegExp(textToFind)}\\b`, 'g') : 
        new RegExp(escapeRegExp(textToFind), 'g');
    
    console.log(`Using ${useWordBoundaries ? 'word boundaries' : 'no boundaries'} for search: "${textToFind}"`);
    
    // Walk through all text nodes in the document
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node: Node): number => {
                // Skip style, script, and empty text nodes
                const parentNode = node.parentNode;
                if (!parentNode || 
                    parentNode.nodeName === 'STYLE' || 
                    parentNode.nodeName === 'SCRIPT' ||
                    (parentNode instanceof Element && parentNode.classList.contains('custom-highlight')) ||
                    !node.textContent || 
                    node.textContent.trim() === '') {
                    return NodeFilter.FILTER_REJECT;
                }
                
                // Skip nodes that don't contain our text
                if (!node.textContent.includes(textToFind)) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                return NodeFilter.FILTER_ACCEPT;
            }
        } as NodeFilter
    );
    
    // Go through each text node and find all occurrences
    let node: Node | null;
    while (node = walker.nextNode()) {
        if (node instanceof Text) {
            const nodeText = node.textContent || '';
            
            let match: RegExpExecArray | null;
            while ((match = regex.exec(nodeText)) !== null) {
                occurrences.push({
                    node: node,
                    startOffset: match.index,
                    text: match[0]
                });
            }
        }
    }
    
    return occurrences;
}

// Helper function to escape special regex characters
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

//Helper function to remove all blurred elements
function removeAllBlurredElements(){
    const blurredElements = document.querySelectorAll(`span[style*="${blurFilter}"]`);
    blurredElements.forEach(el => {
        const parent = el.parentNode;
        if(parent) {
            //Replace the blurred span with its text content
            parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        }
    });

    //Normalize the document to clean up text nodes
    document.body.normalize();
    console.log(`Removed ${blurredElements.length} blurred elements`);
}
