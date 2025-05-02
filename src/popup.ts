import { setBadgeText } from "./common"

console.log("Hello world from Hylytool!")

//Handle ON/OFF switch
const checkBox = document.getElementById("enabled") as HTMLInputElement
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
const input = document.getElementById("item") as HTMLInputElement

chrome.storage.sync.get("item", (data) => {
    input.value = data.item || ""
});
input.addEventListener("change", (event) => {
    if(event.target instanceof HTMLInputElement){
        void chrome.storage.sync.set({"item": event.target.value})
    }
})