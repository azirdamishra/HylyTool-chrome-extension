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
        
        // When extension is disabled, also disable highlight mode
        if (!enabled) {
            const highlightToggle = document.getElementById("highlight-mode") as HTMLInputElement;
            if (highlightToggle && highlightToggle.checked) {
                highlightToggle.checked = false;
                chrome.storage.local.set({highlightMode: false});
                console.log("Highlight mode disabled because extension was disabled");
            }
        }
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
    const colorSwatches = document.querySelectorAll(".color-swatch") as NodeListOf<HTMLButtonElement>;
    const customColorButton = document.querySelector(".custom-color-button") as HTMLButtonElement;
    const popupContainer = document.querySelector(".popup-container") as HTMLElement;
    const extensionToggle = document.getElementById("enabled") as HTMLInputElement;
    const highlightSection = document.querySelector(".highlight-section") as HTMLElement;
    const highlightLabel = document.querySelector(".checkbox-label") as HTMLElement;
    let colorPickerActive = false;

    // Function to update highlight section based on extension status
    function updateHighlightSectionState(extensionEnabled: boolean) {
        // Update the disabled state of the highlight toggle
        if (highlightToggle) {
            highlightToggle.disabled = !extensionEnabled;
        }
        
        // Update the visual appearance
        if (highlightLabel) {
            if (extensionEnabled) {
                highlightLabel.classList.remove('disabled');
            } else {
                highlightLabel.classList.add('disabled');
            }
        }
        
        // Update color swatches
        const swatchesContainer = document.querySelector('.color-swatches');
        if (swatchesContainer) {
            swatchesContainer.classList.toggle('disabled', !extensionEnabled);
            
            colorSwatches.forEach(swatch => {
                swatch.disabled = !extensionEnabled;
                swatch.style.pointerEvents = extensionEnabled ? 'auto' : 'none';
            });
        }
    }

    // Listen for extension toggle changes
    extensionToggle.addEventListener("change", () => {
        const extensionEnabled = extensionToggle.checked;
        updateHighlightSectionState(extensionEnabled);
        
        // If extension is disabled, also disable and uncheck highlight mode
        if (!extensionEnabled && highlightToggle && highlightToggle.checked) {
            highlightToggle.checked = false;
            chrome.storage.local.set({highlightMode: false});
        }
    });

    // Function to update the selected color
    function updateSelectedColor(color: string) {
        // Remove 'selected' class from all swatches
        colorSwatches.forEach(swatch => swatch.classList.remove("selected"));
        
        // Add 'selected' class to the clicked swatch
        const selectedSwatch = Array.from(colorSwatches).find(
            swatch => swatch.dataset.color === color && !swatch.classList.contains("custom-color-button")
        );
        
        if (selectedSwatch) {
            selectedSwatch.classList.add("selected");
        }
        
        // Update the color picker value
        colorPicker.value = color;
        
        // Save the selected color
        chrome.storage.local.set({highlightColor: color});
    }

    // Event listeners for color swatches
    colorSwatches.forEach(swatch => {
        swatch.addEventListener("click", (e) => {
            if (swatch.classList.contains("custom-color-button")) {
                // Show the color picker when the custom button is clicked
                colorPicker.style.display = "block";
                colorPickerActive = true;
                // Use a small timeout to prevent immediate triggering of document click
                setTimeout(() => {
                    colorPicker.click();
                }, 50);
                // Stop propagation to prevent document click from hiding the picker immediately
                e.stopPropagation();
            } else {
                const color = swatch.dataset.color || "#ffff00";
                updateSelectedColor(color);
                colorPickerActive = false;
                colorPicker.style.display = "none";
            }
        });
    });

    // Hide color picker when clicking anywhere in the popup except the picker itself
    document.addEventListener("click", (e) => {
        if (colorPickerActive && e.target !== colorPicker && e.target !== customColorButton) {
            colorPicker.style.display = "none";
            colorPickerActive = false;
        }
    });

    // Prevent clicks on the color picker from bubbling up to document
    colorPicker.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    // Single event listener for highlight toggle - only allow enabling if extension is enabled
    highlightToggle.addEventListener("change", () => {
        // If trying to enable highlight mode but extension is disabled, prevent it
        if (highlightToggle.checked && extensionToggle && !extensionToggle.checked) {
            highlightToggle.checked = false;
            alert("You must enable the extension first before enabling highlight mode.");
            return;
        }
        
        chrome.storage.local.set({highlightMode: highlightToggle.checked});
    });

    // Color picker event listener
    colorPicker.addEventListener("change", (e) => {
        const color = colorPicker.value;
        updateSelectedColor(color);
        
        // Don't immediately hide the color picker to allow for multiple adjustments
        // It will be hidden when clicking outside
        e.stopPropagation();
    });

    // Ensure color picker closes when ESC key is pressed
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && colorPickerActive) {
            colorPicker.style.display = "none";
            colorPickerActive = false;
        }
    });

    // Initialize UI with the saved state
    Promise.all([
        new Promise<{highlightMode?: boolean, highlightColor?: string}>((resolve) => {
            chrome.storage.local.get(["highlightMode", "highlightColor"], (data) => {
                resolve(data as {highlightMode?: boolean, highlightColor?: string});
            });
        }),
        new Promise<{enabled?: boolean}>((resolve) => {
            chrome.storage.sync.get(["enabled"], (data) => {
                resolve(data as {enabled?: boolean});
            });
        })
    ]).then(([localData, syncData]) => {
        const extensionEnabled = syncData.enabled === true;
        
        // Apply highlight mode only if extension is enabled
        if (highlightToggle) {
            const shouldEnableHighlight = localData.highlightMode === true && extensionEnabled;
            highlightToggle.checked = shouldEnableHighlight;
            
            // If extension is disabled, ensure highlight mode is also disabled in storage
            if (!extensionEnabled && localData.highlightMode === true) {
                chrome.storage.local.set({highlightMode: false});
            }
        }
        
        // Update the UI state based on extension status
        updateHighlightSectionState(extensionEnabled);
        
        const savedColor = localData.highlightColor || "#ffff00";
        if (colorPicker) colorPicker.value = savedColor;
        
        // Set the initial selected swatch
        updateSelectedColor(savedColor);
    });
});

