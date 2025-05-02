/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/common.ts":
/*!***********************!*\
  !*** ./src/common.ts ***!
  \***********************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.setBadgeText = setBadgeText;
function setBadgeText(enabled) {
    const text = enabled ? "ON" : "OFF";
    void chrome.action.setBadgeText({ text: text });
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;
/*!**********************!*\
  !*** ./src/popup.ts ***!
  \**********************/

Object.defineProperty(exports, "__esModule", ({ value: true }));
const common_1 = __webpack_require__(/*! ./common */ "./src/common.ts");
console.log("Hello world from Hylytool!");
//Handle ON/OFF switch
const checkBox = document.getElementById("enabled");
chrome.storage.sync.get("enabled", (data) => {
    checkBox.checked = !!data.enabled;
    void (0, common_1.setBadgeText)(data.enabled);
});
checkBox.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) {
        void chrome.storage.sync.set({ "enabled": event.target.checked });
        void (0, common_1.setBadgeText)(event.target.checked);
    }
});
//Handle the input field
const input = document.getElementById("item");
chrome.storage.sync.get("item", (data) => {
    input.value = data.item || "";
});
input.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) {
        void chrome.storage.sync.set({ "item": event.target.value });
    }
});

})();

/******/ })()
;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9wdXAuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEsb0NBR0M7QUFIRCxTQUFnQixZQUFZLENBQUMsT0FBZ0I7SUFDekMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUMsQ0FBQyxLQUFLO0lBQ2xDLEtBQUssTUFBTSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUM7QUFDakQsQ0FBQzs7Ozs7OztVQ0hEO1VBQ0E7O1VBRUE7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7O1VBRUE7VUFDQTs7VUFFQTtVQUNBO1VBQ0E7Ozs7Ozs7Ozs7OztBQ3RCQSx3RUFBdUM7QUFFdkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsQ0FBQztBQUV6QyxzQkFBc0I7QUFDdEIsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQXFCO0FBQ3ZFLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRTtJQUN4QyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTztJQUNqQyxLQUFLLHlCQUFZLEVBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQztBQUNuQyxDQUFDLENBQUM7QUFDRixRQUFRLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUU7SUFDMUMsSUFBRyxLQUFLLENBQUMsTUFBTSxZQUFZLGdCQUFnQixFQUFDLENBQUM7UUFDekMsS0FBSyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBQyxTQUFTLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUMsQ0FBQztRQUMvRCxLQUFLLHlCQUFZLEVBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUM7SUFDM0MsQ0FBQztBQUNMLENBQUMsQ0FBQztBQUVGLHdCQUF3QjtBQUN4QixNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBcUI7QUFFakUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFO0lBQ3JDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLElBQUksSUFBSSxFQUFFO0FBQ2pDLENBQUMsQ0FBQyxDQUFDO0FBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLFFBQVEsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO0lBQ3ZDLElBQUcsS0FBSyxDQUFDLE1BQU0sWUFBWSxnQkFBZ0IsRUFBQyxDQUFDO1FBQ3pDLEtBQUssTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFDLENBQUM7SUFDOUQsQ0FBQztBQUNMLENBQUMsQ0FBQyIsInNvdXJjZXMiOlsid2VicGFjazovL0h5bHlUb29sLWNocm9tZS1FeHRlbnNpb24vLi9zcmMvY29tbW9uLnRzIiwid2VicGFjazovL0h5bHlUb29sLWNocm9tZS1FeHRlbnNpb24vd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vSHlseVRvb2wtY2hyb21lLUV4dGVuc2lvbi8uL3NyYy9wb3B1cC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gc2V0QmFkZ2VUZXh0KGVuYWJsZWQ6IGJvb2xlYW4pe1xuICAgIGNvbnN0IHRleHQgPSBlbmFibGVkID8gXCJPTlwiOiBcIk9GRlwiXG4gICAgdm9pZCBjaHJvbWUuYWN0aW9uLnNldEJhZGdlVGV4dCh7dGV4dDogdGV4dH0pXG59IiwiLy8gVGhlIG1vZHVsZSBjYWNoZVxudmFyIF9fd2VicGFja19tb2R1bGVfY2FjaGVfXyA9IHt9O1xuXG4vLyBUaGUgcmVxdWlyZSBmdW5jdGlvblxuZnVuY3Rpb24gX193ZWJwYWNrX3JlcXVpcmVfXyhtb2R1bGVJZCkge1xuXHQvLyBDaGVjayBpZiBtb2R1bGUgaXMgaW4gY2FjaGVcblx0dmFyIGNhY2hlZE1vZHVsZSA9IF9fd2VicGFja19tb2R1bGVfY2FjaGVfX1ttb2R1bGVJZF07XG5cdGlmIChjYWNoZWRNb2R1bGUgIT09IHVuZGVmaW5lZCkge1xuXHRcdHJldHVybiBjYWNoZWRNb2R1bGUuZXhwb3J0cztcblx0fVxuXHQvLyBDcmVhdGUgYSBuZXcgbW9kdWxlIChhbmQgcHV0IGl0IGludG8gdGhlIGNhY2hlKVxuXHR2YXIgbW9kdWxlID0gX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXSA9IHtcblx0XHQvLyBubyBtb2R1bGUuaWQgbmVlZGVkXG5cdFx0Ly8gbm8gbW9kdWxlLmxvYWRlZCBuZWVkZWRcblx0XHRleHBvcnRzOiB7fVxuXHR9O1xuXG5cdC8vIEV4ZWN1dGUgdGhlIG1vZHVsZSBmdW5jdGlvblxuXHRfX3dlYnBhY2tfbW9kdWxlc19fW21vZHVsZUlkXShtb2R1bGUsIG1vZHVsZS5leHBvcnRzLCBfX3dlYnBhY2tfcmVxdWlyZV9fKTtcblxuXHQvLyBSZXR1cm4gdGhlIGV4cG9ydHMgb2YgdGhlIG1vZHVsZVxuXHRyZXR1cm4gbW9kdWxlLmV4cG9ydHM7XG59XG5cbiIsImltcG9ydCB7IHNldEJhZGdlVGV4dCB9IGZyb20gXCIuL2NvbW1vblwiXG5cbmNvbnNvbGUubG9nKFwiSGVsbG8gd29ybGQgZnJvbSBIeWx5dG9vbCFcIilcblxuLy9IYW5kbGUgT04vT0ZGIHN3aXRjaFxuY29uc3QgY2hlY2tCb3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImVuYWJsZWRcIikgYXMgSFRNTElucHV0RWxlbWVudFxuY2hyb21lLnN0b3JhZ2Uuc3luYy5nZXQoXCJlbmFibGVkXCIsIChkYXRhKSA9PiB7XG4gICAgY2hlY2tCb3guY2hlY2tlZCA9ICEhZGF0YS5lbmFibGVkXG4gICAgdm9pZCBzZXRCYWRnZVRleHQoZGF0YS5lbmFibGVkKVxufSlcbmNoZWNrQm94LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKGV2ZW50KSA9PiB7XG4gICAgaWYoZXZlbnQudGFyZ2V0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCl7XG4gICAgICAgIHZvaWQgY2hyb21lLnN0b3JhZ2Uuc3luYy5zZXQoe1wiZW5hYmxlZFwiOiBldmVudC50YXJnZXQuY2hlY2tlZH0pXG4gICAgICAgIHZvaWQgc2V0QmFkZ2VUZXh0KGV2ZW50LnRhcmdldC5jaGVja2VkKVxuICAgIH1cbn0pXG5cbi8vSGFuZGxlIHRoZSBpbnB1dCBmaWVsZFxuY29uc3QgaW5wdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcIml0ZW1cIikgYXMgSFRNTElucHV0RWxlbWVudFxuXG5jaHJvbWUuc3RvcmFnZS5zeW5jLmdldChcIml0ZW1cIiwgKGRhdGEpID0+IHtcbiAgICBpbnB1dC52YWx1ZSA9IGRhdGEuaXRlbSB8fCBcIlwiXG59KTtcbmlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKGV2ZW50KSA9PiB7XG4gICAgaWYoZXZlbnQudGFyZ2V0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCl7XG4gICAgICAgIHZvaWQgY2hyb21lLnN0b3JhZ2Uuc3luYy5zZXQoe1wiaXRlbVwiOiBldmVudC50YXJnZXQudmFsdWV9KVxuICAgIH1cbn0pIl0sIm5hbWVzIjpbXSwic291cmNlUm9vdCI6IiJ9