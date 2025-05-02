"use strict";
import { applyHighlightToTextNode, reapplyHighlightsFromStorage } from "./common";

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
                // Create a span to wrap just the matching text
                const span = document.createElement('span');
                span.style.filter = blurFilter;
                span.style.display = 'inline';
                
                // Split the text and wrap the matching part
                const parts = node.textContent.split(textToBlur);
                const textNode = document.createTextNode(parts.join(''));
                
                // Replace the original text node with our new structure
                parent.replaceChild(textNode, node);
                
                // Insert the blurred spans between the parts
                for (let i = 0; i < parts.length - 1; i++) {
                    const blurSpan = span.cloneNode(true);
                    blurSpan.textContent = textToBlur;
                    parent.insertBefore(blurSpan, textNode);
                }
                
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
let enabled = true
const keys = ["enabled", "item"]

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
    if(data.highlightMode && enabled){
        console.log('Setting up highlight event listener');
        document.addEventListener('mouseup', () => {
            const selection = window.getSelection();
            if(selection && selection.toString()){
                console.log('Selection made:', selection.toString());
                const range = selection.getRangeAt(0);
                
                
                try {
                    const cloned = range.cloneContents();
                    if (cloned.childNodes.length > 1) {
                        console.warn("Highlight rejected: selection spans multiple nodes.")
                        return;
                    }
                    const span = document.createElement('span');
                    const highlightColor = data.highlightColor || '#ffff00';
                    span.style.backgroundColor = highlightColor;
                    span.className = 'custom-highlight';
                    // Generate a unique ID for this highlight
                    const highlightId = 'highlight-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    span.id = highlightId;

                    range.surroundContents(span);
                    console.log('Highlight applied with ID:', highlightId, 'and color:', highlightColor);

                    //Clean and limit the text length
                    let cleanText = selection.toString().trim().replace(/\s+/g, ' ');
                    if(cleanText.length > 100) cleanText = cleanText.slice(0, 100);
                    
                    //store the highlight
                    const highlightData = {
                        id: highlightId,
                        text: cleanText,
                        color: highlightColor,
                        html: span.outerHTML
                    };

                    const pageKey = window.location.href;
                    chrome.storage.local.get([pageKey], (data) => {
                        const existing = data[pageKey] || [];
                        existing.push(highlightData);
                        chrome.storage.local.set({ [pageKey]: existing }, () => {
                            console.log('Highlight stored:', highlightData);
                        });
                    });
                } catch (e) {
                    console.error('Error applying highlight:', e);
                }
            }
        });
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
    if(request.action === 'extensionStateChanged'){
        console.log("Received extension state change: ", request.enabled);
        enabled = request.enabled;
        const pageKey = window.location.href;
        
        if(enabled){
            //Show all highlights when extension is enabled
            chrome.storage.local.get([pageKey], (data) => {
                const highlights = data[pageKey] || [];
                console.log('Reapplying highlights:', highlights);
                reapplyHighlightsFromStorage(highlights);
            });
        } else {
            //remove all highlights when extension is disabled
            const highlights = document.querySelectorAll('.custom-highlight');
            highlights.forEach(el => {
                const parent = el.parentNode;
                if(parent){
                    parent.replaceChild(document.createTextNode(el.textContent || ''), el);
                }
            });
            // Normalize the document to clean up text nodes
            document.body.normalize();
            console.log('Removed highlights from DOM');
        }
    }
});