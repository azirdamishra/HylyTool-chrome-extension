/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { setBadgeText } from "./common";

console.log("Hello world from Hylytool!");

//Handle ON/OFF switch
const checkBox = document.getElementById("enabled") as HTMLInputElement;
chrome.storage.sync.get("enabled", (data: { enabled?: boolean }) => {
  checkBox.checked = !!data.enabled;
  setBadgeText(!!data.enabled);
});

//send message to content script in all tabs
async function notifyTabs(enabled: boolean) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: "extensionStateChanged",
            enabled,
          });
          console.info(`Message sent to tab ${String(tab.id)}`);
          console.info(
            `Popup received response from tab with title '%s' and url %s`,
            tab.title,
            tab.url,
          );
        } catch (err) {
          console.warn(`Could not send message to tab ${String(tab.id)}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Error querying tabs:", err);
  }
}

checkBox.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement) {
    const enabled = event.target.checked;
    // Mark these promises as intentionally ignored
    void chrome.storage.sync.set({ enabled: enabled });
    setBadgeText(enabled);
    void notifyTabs(enabled);

    // When extension is disabled, also disable highlight mode
    if (!enabled) {
      const highlightToggle = document.getElementById(
        "highlight-mode",
      ) as HTMLInputElement;
      if (highlightToggle.checked) {
        highlightToggle.checked = false;
        void chrome.storage.local.set({ highlightMode: false });
        console.log("Highlight mode disabled because extension was disabled");
      }
    }
  }
});

//Handle the input field
const input = document.getElementById("item") as HTMLInputElement;

chrome.storage.sync.get("item", (data: { item?: string }) => {
  input.value = data.item ?? "";
});
input.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement) {
    void chrome.storage.sync.set({ item: event.target.value });
  }
});

document.addEventListener("DOMContentLoaded", () => {
  //Blur control buttons
  const applyBlurButton = document.getElementById(
    "apply-blur",
  ) as HTMLButtonElement;
  const removeBlurButton = document.getElementById(
    "remove-blur",
  ) as HTMLButtonElement;
  const blurTextInput = document.getElementById("item") as HTMLInputElement;

  //Highlight control buttons
  const highlightToggle = document.getElementById(
    "highlight-mode",
  ) as HTMLInputElement;
  const colorPicker = document.getElementById(
    "color-picker",
  ) as HTMLInputElement;
  const colorSwatches =
    document.querySelectorAll<HTMLButtonElement>(".color-swatch");
  const customColorButton = document.querySelector<HTMLButtonElement>(
    ".custom-color-button",
  );
  const extensionToggle = document.getElementById(
    "enabled",
  ) as HTMLInputElement;
  const highlightLabel = document.querySelector(".checkbox-label");
  let colorPickerActive = false;

  // Function to update highlight section based on extension status
  function updateHighlightSectionState(extensionEnabled: boolean) {
    // Update the disabled state of the highlight toggle
    highlightToggle.disabled = !extensionEnabled;

    // Update the visual appearance
    if (highlightLabel) {
      if (extensionEnabled) {
        highlightLabel.classList.remove("disabled");
      } else {
        highlightLabel.classList.add("disabled");
      }
    }

    // Update color swatches
    const swatchesContainer = document.querySelector(".color-swatches");
    if (swatchesContainer) {
      swatchesContainer.classList.toggle("disabled", !extensionEnabled);

      colorSwatches.forEach((swatch) => {
        swatch.disabled = !extensionEnabled;
        swatch.style.pointerEvents = extensionEnabled ? "auto" : "none";
      });
    }
  }

  // Listen for extension toggle changes
  extensionToggle.addEventListener("change", () => {
    const extensionEnabled = extensionToggle.checked;
    updateHighlightSectionState(extensionEnabled);

    // If extension is disabled, also disable and uncheck highlight mode
    if (!extensionEnabled && highlightToggle.checked) {
      highlightToggle.checked = false;
      void chrome.storage.local.set({ highlightMode: false });
    }
  });

  // Function to update the selected color
  function updateSelectedColor(color: string) {
    // Remove 'selected' class from all swatches
    colorSwatches.forEach((swatch) => {
      swatch.classList.remove("selected");
    });

    // Add 'selected' class to the clicked swatch
    const selectedSwatch = Array.from(colorSwatches).find(
      (swatch) =>
        swatch.dataset.color === color &&
        !swatch.classList.contains("custom-color-button"),
    );

    if (selectedSwatch) {
      selectedSwatch.classList.add("selected");
    }

    // Update the color picker value
    colorPicker.value = color;

    // Save the selected color
    void chrome.storage.local.set({ highlightColor: color });
  }

  // Event listeners for color swatches
  colorSwatches.forEach((swatch) => {
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
        const color = swatch.dataset.color ?? "#ffff00";
        updateSelectedColor(color);
        colorPickerActive = false;
        colorPicker.style.display = "none";
      }
    });
  });

  // Hide color picker when clicking anywhere in the popup except the picker itself
  document.addEventListener("click", (e) => {
    if (
      colorPickerActive &&
      e.target !== colorPicker &&
      e.target !== customColorButton
    ) {
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
    if (highlightToggle.checked && !extensionToggle.checked) {
      highlightToggle.checked = false;
      alert(
        "You must enable the extension first before enabling highlight mode.",
      );
      return;
    }

    void chrome.storage.local.set({ highlightMode: highlightToggle.checked });
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
  void (async () => {
    try {
      const [localData, syncData] = await Promise.all([
        new Promise<{ highlightMode?: boolean; highlightColor?: string }>(
          (resolve) => {
            chrome.storage.local.get(
              ["highlightMode", "highlightColor"],
              (data: Record<string, unknown>) => {
                resolve({
                  highlightMode: !!data.highlightMode,
                  highlightColor: data.highlightColor as string | undefined,
                });
              },
            );
          },
        ),
        new Promise<{ enabled?: boolean }>((resolve) => {
          chrome.storage.sync.get(
            ["enabled"],
            (data: Record<string, unknown>) => {
              resolve({ enabled: !!data.enabled });
            },
          );
        }),
      ]);

      const extensionEnabled = syncData.enabled === true;

      // Apply highlight mode only if extension is enabled
      if (highlightToggle) {
        const shouldEnableHighlight =
          localData.highlightMode === true && extensionEnabled;
        highlightToggle.checked = shouldEnableHighlight;

        // If extension is disabled, ensure highlight mode is also disabled in storage
        if (!extensionEnabled && localData.highlightMode === true) {
          void chrome.storage.local.set({ highlightMode: false });
        }
      }

      // Update the UI state based on extension status
      updateHighlightSectionState(extensionEnabled);

      const savedColor = localData.highlightColor ?? "#ffff00";
      colorPicker.value = savedColor;

      // Set the initial selected swatch
      updateSelectedColor(savedColor);
    } catch (err) {
      console.error("Error initializing UI:", err);
    }
  })();

  //Apply blur without page reload
  applyBlurButton.addEventListener("click", () => {
    const textToBlur = blurTextInput.value.trim();
    if (!textToBlur) return;

    //save to storage
    void (async () => {
      try {
        await chrome.storage.sync.set({ item: textToBlur });

        //Send message to content script to apply blur immediately
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        // Replace eslint-disable with explicit type guard function
        if (tabs.length === 0) {
          console.warn("No active tab found");
          return;
        }

        const tabId = tabs[0].id;
        if (tabId === undefined) {
          console.warn("Tab has no ID");
          return;
        }

        await chrome.tabs.sendMessage(tabId, {
          action: "applyBlur",
          text: textToBlur,
        });
        console.log(`Applied blur to text: ${textToBlur}`);
      } catch (err) {
        console.warn(`Could not apply blur: `, err);
      }
    })();
  });

  //Remove all blur effects
  removeBlurButton.addEventListener("click", () => {
    //Clear the input field
    blurTextInput.value = "";

    //Save empty string to storage and remove blur
    void (async () => {
      try {
        await chrome.storage.sync.set({ item: "" });

        //Send message to content script to remove blur
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        // Replace eslint-disable with explicit type guard function
        if (tabs.length === 0) {
          console.warn("No active tab found");
          return;
        }

        const tabId = tabs[0].id;
        if (tabId === undefined) {
          console.warn("Tab has no ID");
          return;
        }

        await chrome.tabs.sendMessage(tabId, {
          action: "removeBlur",
        });
        console.log("Removed all blur effects");
      } catch (err) {
        console.warn(`Could not remove blur: `, err);
      }
    })();
  });
});
