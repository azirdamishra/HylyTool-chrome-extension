import { setBadgeText } from "./common"

console.log("Hello world from Hylytool!")

//Handle ON/OFF switch
const checkBox = document.getElementById("enabled") as HTMLInputElement
chrome.storage.sync.get("enabled", (data) => {
    checkBox.checked = !!data.enabled
    void setBadgeText(data.enabled)
})

//send message to content script in all tabs
async function notifyTabs(enabled: boolean) {
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.id) {
                try {
                    await chrome.tabs.sendMessage(tab.id, { action: 'extensionStateChanged', enabled });
                    console.info(`Message sent to tab ${tab.id}`);
                    console.info(`Popup received response from tab with title '%s' and url %s`, tab.title, tab.url)
                } catch (err) {
                    console.warn(`Could not send message to tab ${tab.id}:`, err);
                }
            }
        }
    } catch (err) {
        console.error('Error querying tabs:', err);
    }
}

checkBox.addEventListener("change", (event) => {
    if(event.target instanceof HTMLInputElement){
        const enabled = event.target.checked;
        void chrome.storage.sync.set({"enabled": enabled})
        void setBadgeText(enabled)
        void notifyTabs(enabled)
    }
})

//Handle the input field
const input = document.getElementById("item") as HTMLInputElement

chrome.storage.sync.get("item", (data) => {
    input.value = data.item || ""
});
input.addEventListener("change", (event) => {
    if(event.target instanceof HTMLInputElement){
        void chrome.storage.sync.set({"item": event.target.value})
    }
})

document.addEventListener("DOMContentLoaded", () => {
    const highlightToggle = document.getElementById("highlight-mode") as HTMLInputElement;
    const colorPicker = document.getElementById("color-picker") as HTMLInputElement;

    // Single event listener for highlight toggle
    highlightToggle.addEventListener("change", () => {
        chrome.storage.local.set({highlightMode: highlightToggle.checked});
    });

    // Separate event listener for color picker
    colorPicker.addEventListener("change", () => {
        chrome.storage.local.set({highlightColor: colorPicker.value});
    });

    //Initialize UI with the saved state
    chrome.storage.local.get(["highlightMode", "highlightColor"], (data) => {
        if (highlightToggle) highlightToggle.checked = data.highlightMode || false;
        if (colorPicker) colorPicker.value = data.highlightColor || "#ffff00";
    });
});

