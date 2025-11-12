import socket from "../socket";
import {store} from "../store";

socket.on("irssi:status", function (data) {
	if (data.connected) {
		// irssi WebSocket reconnected successfully
		store.commit("currentUserVisibleError", "✓ Connected to irssi WebSocket");

		// Clear the message after 3 seconds
		setTimeout(() => {
			if (store.state.currentUserVisibleError === "✓ Connected to irssi WebSocket") {
				store.commit("currentUserVisibleError", null);
			}
		}, 3000);

		// Request fresh state from server
		// This will trigger init event with updated networks
		socket.emit("setting:get");
	} else {
		// irssi WebSocket disconnected - CLEAR networks from UI
		const errorMsg = data.error || "Lost connection to irssi WebSocket";

		// CLEAR all networks from store
		store.commit("networks", []);

		// Show warning in UI (always show, since we just cleared networks)
		store.commit("currentUserVisibleError", errorMsg + " - Reconnecting...");
	}
});
