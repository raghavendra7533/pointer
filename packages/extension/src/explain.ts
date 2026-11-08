document.getElementById("reason")!.textContent = new URLSearchParams(location.search).get("reason") ?? "";
addEventListener("pagehide", () => void chrome.runtime.sendMessage({ type: "explain-closed" }));
