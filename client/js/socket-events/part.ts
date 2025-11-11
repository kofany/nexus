import socket from "../socket.js";
import {store} from "../store.js";
import {switchToChannel} from "../router.js";

socket.on("part", async function (data) {
	// IDEMPOTENT: Check if channel exists before processing
	const channel = store.getters.findChannel(data.chan);

	if (!channel) {
		// Channel already removed (idempotent - safe to ignore)
		return;
	}

	// When parting from the active channel/query, jump to the network's lobby
	if (store.state.activeChannel && store.state.activeChannel.channel.id === data.chan) {
		switchToChannel(channel.network.channels[0]);
	}

	// Remove channel from network
	const index = channel.network.channels.findIndex((c) => c.id === data.chan);

	if (index !== -1) {
		channel.network.channels.splice(index, 1);
	}

	await store.dispatch("partChannel", channel);
});
