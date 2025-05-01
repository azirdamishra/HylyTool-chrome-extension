"use strict";

console.log("Hello world from Hylytool!")

function setBadgeText(enabled){
    const text = enabled? "ON" : "OFF"
    void chrome.action.setBadgeText({text: text})
}

//Handle ON/OFF switch
const checkBox = document.getElementById("enabled")
chrome.storage.sync.get("enabled", (data) => {
    checkBox.checked = !!data.enabled
    void setBadgeText(data.enabled)
})
checkBox.addEventListener("change", (event) => {
    if(event.target instanceof HTMLInputElement){
        void chrome.storage.sync.set({"enabled": event.target.checked})
        void setBadgeText(event.target.checked)
    }
})

//Handle the input field
const input = document.getElementById("item")

chrome.storage.sync.get("item", (data) => {
    input.value = data.item || ""
});
input.addEventListener("change", (event) => {
    if(event.target instanceof HTMLInputElement){
        void chrome.storage.sync.set({"item": event.target.value})
    }
})