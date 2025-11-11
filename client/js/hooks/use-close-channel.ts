import eventbus from "../eventbus";
import socket from "../socket";
import {ClientChan} from "../types";
import {ChanType} from "../../../shared/types/chan";
import {store} from "../store";
import {switchToChannel} from "../router";

export default function useCloseChannel(channel: ClientChan) {
	return () => {
		if (channel.type === ChanType.LOBBY) {
			eventbus.emit(
				"confirm-dialog",
				{
					title: "Remove network",
					text: `Are you sure you want to quit and remove ${channel.name}? This cannot be undone.`,
					button: "Remove network",
				},
				(result: boolean) => {
					if (!result) {
						return;
					}

					channel.closed = true;
					socket.emit("input", {
						target: Number(channel.id),
						text: "/quit",
					});
				}
			);

			return;
		}

		// CLIENT-DRIVEN ARCHITECTURE: Update UI immediately, then notify backend

		// STEP 1: Find the network
		const netChan = store.getters.findChannel(channel.id);

		if (!netChan) {
			// Channel already removed (idempotent)
			return;
		}

		// STEP 2: Switch to lobby if this was the active channel
		if (store.state.activeChannel && store.state.activeChannel.channel.id === channel.id) {
			switchToChannel(netChan.network.channels[0]);
		}

		// STEP 3: Remove channel from local state IMMEDIATELY
		const index = netChan.network.channels.findIndex((c) => c.id === channel.id);

		if (index !== -1) {
			netChan.network.channels.splice(index, 1);
		}

		// STEP 4: Dispatch store action (clean up mentions, etc.)
		store.dispatch("partChannel", netChan);

		// STEP 5: Emit new part_channel event to backend (async confirmation)
		socket.emit("part_channel", {
			networkUuid: netChan.network.uuid,
			channelId: channel.id,
		});
	};
}
