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