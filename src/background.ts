import { setBadgeText } from "./common";

function startUp() {
  chrome.storage.sync.get("enabled", (data) => {
    setBadgeText(!!data.enabled);
  });
}

//Ensure the backgrond script always runs
chrome.runtime.onStartup.addListener(startUp);
chrome.runtime.onInstalled.addListener(startUp);
