import socket from "../socket.js";
import {store} from "../store.js";

/**
 * Handle activity_update event from irssi backend
 * Updates unread and highlight counters for a channel
 */
socket.on("activity_update", function (data) {
	const receivingChannel = store.getters.findChannel(data.chan);

	if (!receivingChannel) {
		return;
	}

	const channel = receivingChannel.channel;

	// Do not update counters if this channel is currently active
	// (user is viewing it, so it's already marked as read)
	const isActiveChannel =
		store.state.activeChannel && store.state.activeChannel.channel === channel;

	if (!isActiveChannel) {
		// Update unread and highlight counters from irssi
		if (typeof data.unread !== "undefined") {
			channel.unread = data.unread;
		}

		if (typeof data.highlight !== "undefined") {
			channel.highlight = data.highlight;
		}
	}
});
