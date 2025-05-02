"use strict";

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

    //Only start observing the DOM if the extension is enabled and there is text to blur
    if(enabled && textToBlur.trim().length > 0){
        console.log("Starting DOM observation");
        observer.observe(document, {
            attributes: false,
            characterData: true,
            childList: true,
            subtree: true
        })
        //Process the initial page content
        processNode(document)
    } else {
        console.log("Not starting observation because:", {
            enabled,
            hasText: textToBlur.trim().length > 0
        });
    }
})


//highlighting text
chrome.storage.local.get(['highlightMode', 'highlightColor'], ({ highlightMode, highlightColor}) => {
    if(highlightMode){
        document.addEventListener('mouseup', () => {
            const selection = window.getSelection();
            if(selection && selection.toString()){
                const range = selection.getRangeAt(0);
                const span = document.createElement('span');
                span.style.backgroundColor = highlightColor || '#ffff00';
                span.className = 'custom-highlight';
                try {
                    range.surroundContents(span);
                    
                    //store the highlight
                    const pageKey = window.location.href;
                    chrome.storage.local.get([pageKey], (data) => {
                        const existing = data[pageKey] || [];
                        existing.push({
                            text: selection.toString(),
                            color: highlightColor || '#ffff00',
                            range: {
                                start: range.startOffset,
                                end: range.endOffset
                            }
                        });
                        chrome.storage.local.set({ [pageKey]: existing });
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
    const pageKey = window.location.href;
    chrome.storage.local.get([pageKey, 'highlightMode'], (data) => {
        if (!data.highlightMode) return;
        
        const highlights = data[pageKey] || [];
        for(const item of highlights){
            const textNodes = Array.from(document.body.querySelectorAll('*'))
                                .flatMap(n => Array.from(n.childNodes))
                                .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent?.includes(item.text));

            for(const node of textNodes){
                try {
                    const span = document.createElement('span');
                    span.style.backgroundColor = item.color || '#ffff00';
                    span.className = 'custom-highlight';
                    const range = document.createRange();
                    const idx = node.textContent!.indexOf(item.text);
                    if(idx !== -1) {
                        range.setStart(node, idx);
                        range.setEnd(node, idx + item.text.length);
                        range.surroundContents(span);
                    }
                } catch (e) {
                    console.error('Error reapplying highlight:', e);
                }
            }
        }
    });
});

//Toggle in popup to remove .custom-highlight span if extension is turned off
chrome.runtime.onMessage.addListener((request) => {
    if(request.action === 'clearHighlights'){
        document.querySelectorAll('.custom-highlight').forEach(el => {
            const parent = el.parentNode;
            if(parent){
                parent.replaceChild(document.createTextNode(el.textContent || ''), el);
            }
        });
    }
});