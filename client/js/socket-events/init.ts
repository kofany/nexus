import socket from "../socket";
import storage from "../localStorage";
import {toClientChan} from "../chan";
import {router, switchToChannel, navigate} from "../router";
import {store} from "../store";
import parseIrcUri from "../helpers/parseIrcUri";
import {ClientNetwork, ClientChan} from "../types";
import {SharedNetwork, SharedNetworkChan} from "../../../shared/types/network";

socket.on("init", async function (data) {
	// SAVE TOKEN TO LOCALSTORAGE (NexusIRC auth, independent from irssi)
	if (data.token) {
		storage.set("token", data.token);
	}

	const mergedNetworks = mergeNetworkData(data.networks);

	store.commit("networks", mergedNetworks);
	store.commit("isConnected", true);
	store.commit("currentUserVisibleError", null);

	// Show warning if irssi disconnected but we have cached networks
	if (
		data.irssiConnectionStatus &&
		!data.irssiConnectionStatus.connected &&
		data.networks.length > 0
	) {
		store.commit(
			"currentUserVisibleError",
			data.irssiConnectionStatus.error || "irssi WebSocket disconnected - showing cached data"
		);

		setTimeout(() => {
			store.commit("currentUserVisibleError", null);
		}, 5000);
	}

	if (!store.state.appLoaded) {
		store.commit("appLoaded");

		socket.emit("setting:get");

		try {
			await router.isReady();
		} catch (e: any) {
			// if the router throws an error, it means the route isn't matched,
			// so we can continue on.
		}

		if (window.g_NexusLoungeRemoveLoading) {
			window.g_NexusLoungeRemoveLoading();
		}

		if (await handleQueryParams()) {
			// If we handled query parameters like irc:// links or just general
			// connect parameters in public mode, then nothing to do here
			return;
		}

		// If we are on an unknown route or still on SignIn component
		// then we can open last known channel on server, or Connect window if none
		if (!router.currentRoute?.value?.name || router.currentRoute?.value?.name === "SignIn") {
			const channel = store.getters.findChannel(data.active);

			if (channel) {
				switchToChannel(channel.channel);
			} else if (store.state.networks.length > 0) {
				// Server is telling us to open a channel that does not exist
				// For example, it can be unset if you first open the page after server start
				switchToChannel(store.state.networks[0].channels[0]);
			} else {
				await navigate("Connect").catch(() => {
					// Ignore navigation errors
				});
			}
		}
	}
});

function mergeNetworkData(newNetworks: SharedNetwork[]): ClientNetwork[] {
	const stored = storage.get("nexuslounge.networks.collapsed");
	const collapsedNetworks = stored ? new Set(JSON.parse(stored)) : new Set();
	const result: ReturnType<typeof mergeNetworkData> = [];

	// SPECIAL CASE: If we're receiving networks after disconnect (store is empty),
	// don't try to merge - just create fresh networks
	const currentNetworks = store.state.networks;

	if (currentNetworks.length === 0 && newNetworks.length > 0) {
		for (const sharedNet of newNetworks) {
			const newNet: ClientNetwork = {
				...sharedNet,
				channels: sharedNet.channels.map(toClientChan),
				isJoinChannelShown: false,
				isCollapsed: collapsedNetworks.has(sharedNet.uuid),
			};
			result.push(newNet);
		}

		return result;
	}

	// Normal merge logic (reconnect with existing networks)
	for (const sharedNet of newNetworks) {
		const currentNetwork = store.getters.findNetwork(sharedNet.uuid);

		// If this network is new, set some default variables and initalize channel variables
		if (!currentNetwork) {
			const newNet: ClientNetwork = {
				...sharedNet,
				channels: sharedNet.channels.map(toClientChan),
				isJoinChannelShown: false,
				isCollapsed: collapsedNetworks.has(sharedNet.uuid),
			};
			result.push(newNet);
			continue;
		}

		// Merge received network object into existing network object on the client
		// so the object reference stays the same (e.g. for currentChannel state)
		for (const key in sharedNet) {
			if (!Object.prototype.hasOwnProperty.call(sharedNet, key)) {
				continue;
			}

			// Channels require extra care to be merged correctly
			if (key === "channels") {
				currentNetwork.channels = mergeChannelData(
					currentNetwork.channels,
					sharedNet.channels
				);
			} else {
				currentNetwork[key] = sharedNet[key];
			}
		}

		result.push(currentNetwork);
	}

	return result;
}

function mergeChannelData(
	oldChannels: ClientChan[],
	newChannels: SharedNetworkChan[]
): ClientChan[] {
	const result: ReturnType<typeof mergeChannelData> = [];

	for (const newChannel of newChannels) {
		const currentChannel = oldChannels.find((chan) => chan.id === newChannel.id);

		if (!currentChannel) {
			// This is a new channel that was joined while client was disconnected, initialize it
			const current = toClientChan(newChannel);
			result.push(current);
			emitNamesOrMarkUsersOudated(current); // TODO: this should not carry logic like that
			continue;
		}

		// Merge received channel object into existing currentChannel
		// so the object references are exactly the same (e.g. in store.state.activeChannel)

		emitNamesOrMarkUsersOudated(currentChannel); // TODO: this should not carry logic like that

		// Reconnection only sends new messages, so merge it on the client
		// Only concat if server sent us less than 100 messages so we don't introduce gaps
		if (currentChannel.messages && newChannel.messages.length < 100) {
			currentChannel.messages = currentChannel.messages.concat(newChannel.messages);
		} else {
			currentChannel.messages = newChannel.messages;
		}

		// TODO: this is copies more than what the compiler knows about
		for (const key in newChannel) {
			if (!Object.hasOwn(currentChannel, key)) {
				continue;
			}

			if (key === "messages") {
				// already handled
				continue;
			}

			currentChannel[key] = newChannel[key];
		}

		result.push(currentChannel);
	}

	return result;
}

function emitNamesOrMarkUsersOudated(chan: ClientChan) {
	if (store.state.activeChannel && store.state.activeChannel.channel === chan) {
		// For currently open channel, request the user list straight away
		socket.emit("names", {
			target: chan.id,
		});
		chan.usersOutdated = false;
		return;
	}

	// For all other channels, mark the user list as outdated
	// so an update will be requested whenever user switches to these channels
	chan.usersOutdated = true;
}

async function handleQueryParams() {
	if (!("URLSearchParams" in window)) {
		return false;
	}

	const params = new URLSearchParams(document.location.search);

	if (params.has("uri")) {
		// Set default connection settings from IRC protocol links
		const uri = params.get("uri");
		const queryParams = parseIrcUri(String(uri));
		removeQueryParams();
		await router.push({name: "Connect", query: queryParams});
		return true;
	}

	if (document.body.classList.contains("public") && document.location.search) {
		// Set default connection settings from url params
		const queryParams = Object.fromEntries(params.entries());
		removeQueryParams();
		await router.push({name: "Connect", query: queryParams});
		return true;
	}

	return false;
}

// Remove query parameters from url without reloading the page
function removeQueryParams() {
	const cleanUri = window.location.origin + window.location.pathname + window.location.hash;
	window.history.replaceState(null, "", cleanUri);
}
