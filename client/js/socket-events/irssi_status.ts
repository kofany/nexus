import socket from "../socket";
import {store} from "../store";

socket.on("irssi:status", function (data) {
	console.log("[IRSSI_STATUS] ===============================================");
	console.log("[IRSSI_STATUS] Received irssi:status event");
	console.log("[IRSSI_STATUS] data.connected:", data.connected);
	console.log("[IRSSI_STATUS] BEFORE: store.state.networks.length:", store.state.networks.length);

	if (data.connected) {
		// irssi WebSocket reconnected successfully
		console.log("[IRSSI_STATUS] ✅ Reconnected - showing success message");
		store.commit("currentUserVisibleError", "✓ Connected to irssi WebSocket");

		// Clear the message after 3 seconds
		setTimeout(() => {
			if (store.state.currentUserVisibleError === "✓ Connected to irssi WebSocket") {
				store.commit("currentUserVisibleError", null);
			}
		}, 3000);

		// Request fresh state from server
		// This will trigger init event with updated networks
		console.log("[IRSSI_STATUS] Requesting fresh state from server (setting:get)");
		socket.emit("setting:get");
	} else {
		// irssi WebSocket disconnected - CLEAR networks from UI
		const errorMsg = data.error || "Lost connection to irssi WebSocket";

		console.log("[IRSSI_STATUS] ❌ Disconnected - CLEARING networks from UI");
		console.log("[IRSSI_STATUS] Error message:", errorMsg);

		// CLEAR all networks from store
		store.commit("networks", []);
		console.log(
			"[IRSSI_STATUS] AFTER CLEAR: store.state.networks.length:",
			store.state.networks.length
		);

		// Show warning in UI (always show, since we just cleared networks)
		store.commit("currentUserVisibleError", errorMsg + " - Reconnecting...");
	}
});
