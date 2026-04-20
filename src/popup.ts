/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { setBadgeText, exportHighlights, importHighlights, flushAllHighlights } from "./common";

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
    void chrome.storage.sync.set({ enabled: enabled });
    setBadgeText(enabled);
    void notifyTabs(enabled);
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
  // Quota warning banner
  const quotaWarning = document.getElementById("quota-warning") as HTMLDivElement;
  const quotaDismiss = document.getElementById("quota-warning-dismiss") as HTMLButtonElement;

  chrome.storage.local.get(
    ["syncQuotaExceeded"],
    (data: { syncQuotaExceeded?: boolean }) => {
      if (data.syncQuotaExceeded) {
        quotaWarning.style.display = "flex";
      }
    },
  );

  quotaDismiss.addEventListener("click", () => {
    quotaWarning.style.display = "none";
    void chrome.storage.local.remove("syncQuotaExceeded");
  });

  //Blur control buttons
  const applyBlurButton = document.getElementById(
    "apply-blur",
  ) as HTMLButtonElement;
  const removeBlurButton = document.getElementById(
    "remove-blur",
  ) as HTMLButtonElement;
  const blurTextInput = document.getElementById("item") as HTMLInputElement;

  //Highlight control buttons
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
  const presetColorSwatches = Array.from(colorSwatches).filter(
    (swatch) => !swatch.classList.contains("custom-color-button"),
  );

  function normalizeColorValue(color: string): string {
    return color.trim().toLowerCase();
  }

  // Disable / enable the color picker controls when the extension is toggled
  function updateHighlightSectionState(extensionEnabled: boolean) {
    const swatchesContainer = document.querySelector(".color-swatches");
    if (swatchesContainer) {
      swatchesContainer.classList.toggle("disabled", !extensionEnabled);
      colorSwatches.forEach((swatch) => {
        swatch.disabled = !extensionEnabled;
        swatch.style.pointerEvents = extensionEnabled ? "auto" : "none";
      });
      colorPicker.disabled = !extensionEnabled;
    }
  }

  // Listen for extension toggle changes
  extensionToggle.addEventListener("change", () => {
    updateHighlightSectionState(extensionToggle.checked);
  });

  // Function to update the selected color
  function updateSelectedColor(color: string) {
    // Remove 'selected' class from all swatches
    colorSwatches.forEach((swatch) => {
      swatch.classList.remove("selected");
    });

    // Add 'selected' class to the clicked swatch
    const normalizedColor = normalizeColorValue(color);
    const selectedSwatch = presetColorSwatches.find(
      (swatch) =>
        normalizeColorValue(swatch.dataset.color ?? "") === normalizedColor,
    );

    if (selectedSwatch) {
      selectedSwatch.classList.add("selected");
      customColorButton?.classList.remove("custom-color-active");
      if (customColorButton) {
        customColorButton.style.backgroundColor = "";
        customColorButton.textContent = "+";
        customColorButton.title = "Pick a custom color";
      }
    } else if (customColorButton) {
      customColorButton.classList.add("selected", "custom-color-active");
      customColorButton.style.backgroundColor = color;
      customColorButton.textContent = "";
      customColorButton.title = `Custom color: ${color}`;
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
        if (!extensionToggle.checked) return;
        // Open native picker only when the + button is clicked.
        colorPicker.click();
        e.stopPropagation();
      } else {
        const color = swatch.dataset.color ?? "#FFF4B3";
        updateSelectedColor(color);
      }
    });
  });

  // Color picker event listener
  colorPicker.addEventListener("change", () => {
    const color = colorPicker.value;
    updateSelectedColor(color);
  });

  // Initialize UI with the saved state
  void (async () => {
    try {
      const [localData, syncData] = await Promise.all([
        new Promise<{ highlightColor?: string }>((resolve) => {
          chrome.storage.local.get(
            ["highlightColor"],
            (data: Record<string, unknown>) => {
              resolve({
                highlightColor: data.highlightColor as string | undefined,
              });
            },
          );
        }),
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
      updateHighlightSectionState(extensionEnabled);

      const savedColor = localData.highlightColor ?? "#FFF4B3";
      colorPicker.value = savedColor;
      updateSelectedColor(savedColor);
    } catch (err) {
      console.error("Error initializing UI:", err);
    }
  })();

  // Export highlights as a JSON file download
  const exportButton = document.getElementById(
    "export-highlights",
  ) as HTMLButtonElement;
  const importButton = document.getElementById(
    "import-highlights",
  ) as HTMLButtonElement;
  const importFileInput = document.getElementById(
    "import-file-input",
  ) as HTMLInputElement;

  exportButton.addEventListener("click", () => {
    void (async () => {
      try {
        const json = await exportHighlights();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `hylytool-highlights-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        console.log("Highlights exported");
      } catch (err) {
        console.error("Export failed:", err);
      }
    })();
  });

  importButton.addEventListener("click", () => {
    importFileInput.click();
  });

  // Flush (purge) all highlights from storage
  const purgeButton = document.getElementById(
    "purge-highlights",
  ) as HTMLButtonElement;

  purgeButton.addEventListener("click", () => {
    if (
      !confirm(
        "This will permanently delete ALL highlights across every page. This cannot be undone. Continue?",
      )
    )
      return;

    void (async () => {
      try {
        await flushAllHighlights();
        console.log("All highlights purged from storage");
        alert("All highlights have been deleted. Reload any open pages to clear them visually.");
      } catch (err) {
        console.error("Purge failed:", err);
        alert("Purge failed — please try again.");
      }
    })();
  });

  importFileInput.addEventListener("change", () => {
    const file = importFileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        try {
          await importHighlights(reader.result as string);
          console.log("Highlights imported successfully");
          alert("Highlights imported! Reload the relevant pages to see them.");
        } catch (err) {
          console.error("Import failed:", err);
          alert("Import failed — please check the file format.");
        } finally {
          importFileInput.value = "";
        }
      })();
    };
    reader.readAsText(file);
  });

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
