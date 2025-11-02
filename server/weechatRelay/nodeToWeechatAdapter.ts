/**
 * Node to WeeChat Adapter
 *
 * Listens to IrssiClient events (same as Vue frontend) and translates them to WeeChat Relay protocol.
 *
 * Architecture:
 * - Vue <-> Socket.io <-> IrssiClient (Node) <-> erssi fe-web
 * - Lith <-> WeeChat Relay <-> NodeToWeeChatAdapter <-> IrssiClient (Node) <-> erssi fe-web
 *
 * Key insight: We don't translate erssi → WeeChat, we translate Node → WeeChat!
 * IrssiClient already has all the data (buffers, messages, nicklist, unread/highlight).
 * We just need to listen to the same events that Vue listens to.
 *
 * Events we listen to (same as Vue):
 * - init: Initial state (networks, channels, messages)
 * - msg: New message (with unread/highlight)
 * - names: Nicklist update
 * - join: New channel opened
 * - part: Channel closed
 * - topic: Topic changed
 * - activity_update: Unread/highlight changed
 * - network: New network added
 * - network:status: Network connection status
 * - nick: Nick changed
 */

import {EventEmitter} from "events";
import log from "../log";
import colors from "chalk";
import {WeeChatMessage, OBJ_HDATA, OBJ_STRING} from "./weechatProtocol";
import {buildHData, buildEmptyHData, HDataField, HDataObject, stringToPointer, generatePointer} from "./weechatHData";
import {IrssiClient} from "../irssiClient";
import {NetworkData} from "../feWebClient/feWebAdapter";
import Chan from "../models/chan";
import Msg from "../models/msg";
import User from "../models/user";
import {ChanType} from "../../shared/types/chan";

/**
 * Node to WeeChat Adapter
 *
 * This adapter acts as a "virtual browser" that receives the same events as Vue frontend.
 * It translates these events to WeeChat Relay protocol and emits them to connected Lith clients.
 */
export class NodeToWeeChatAdapter extends EventEmitter {
	private irssiClient: IrssiClient;

	constructor(irssiClient: IrssiClient) {
		super();
		this.irssiClient = irssiClient;

		// Increase max listeners - we may have multiple WeeChat clients connected
		// Each client adds ~6 listeners (buffer_opened, buffer_closing, buffer_line_added, etc.)
		// Default is 10, so allow up to 50 clients (300 listeners)
		this.setMaxListeners(300);

		log.info(`${colors.cyan("[Node->WeeChat]")} Adapter initialized for user ${irssiClient.name}`);
	}

	/**
	 * Get buffer pointer for a channel
	 * We use channel.id as the pointer (consistent across sessions)
	 * Generate large pointer values to match WeeChat's format (64-bit addresses)
	 */
	public getBufferPointer(channelId: number): bigint {
		// Generate a large pointer value from channel ID
		// WeeChat uses real memory addresses (e.g., 0x8690fc000)
		// We simulate this by using a base address + channel ID
		const BASE_ADDRESS = 0x8690000000n; // Base address similar to WeeChat
		return BASE_ADDRESS + BigInt(channelId) * 0x1000n; // Each buffer 4KB apart
	}

	/**
	 * Find network and channel by channel ID
	 */
	private findChannel(channelId: number): {network: NetworkData; channel: Chan} | null {
		for (const network of this.irssiClient.networks) {
			const channel = network.channels.find((c) => c.id === channelId);
			if (channel) {
				return {network, channel};
			}
		}
		return null;
	}

	/**
	 * Handle 'msg' event from IrssiClient
	 * This is called when a new message arrives (same event that Vue receives)
	 */
	public handleMsgEvent(data: {chan: number; msg: Msg; unread: number; highlight: number}): void {
		const found = this.findChannel(data.chan);
		if (!found) {
			log.warn(`${colors.yellow("[Node->WeeChat]")} Channel ${data.chan} not found for msg event`);
			return;
		}

		const {network, channel} = found;
		const bufferPtr = this.getBufferPointer(data.chan);

		log.debug(`${colors.cyan("[Node->WeeChat]")} msg event: ${channel.name} on ${network.name}`);

		// Emit _buffer_line_added event for WeeChat clients
		this.emit("buffer_line_added", {
			bufferPtr,
			networkUuid: network.uuid,
			channelId: data.chan,
			channelName: channel.name,
			msg: data.msg,
			unread: data.unread,
			highlight: data.highlight,
		});

		// IMPORTANT: For JOIN/KICK/PART/QUIT messages, also send nicklist_diff!
		// Vue updates nicklist locally in updateUserList(), but Lith expects _nicklist_diff from server
		// The user has already been added/removed from channel.users by FeWebAdapter before this event
		if (data.msg.type === "join" || data.msg.type === "kick" || data.msg.type === "part" || data.msg.type === "quit") {
			log.info(`${colors.cyan("[Node->WeeChat]")} ${data.msg.type.toUpperCase()} detected - sending nicklist_diff for ${channel.name}`);

			// Send updated nicklist (user already added/removed by FeWebAdapter)
			const users = Array.from(channel.users.values());
			this.emit("nicklist_diff", {
				bufferPtr,
				networkUuid: network.uuid,
				channelId: data.chan,
				users: users,
			});
		}
	}

	/**
	 * Handle 'names' event from IrssiClient
	 * This is called when nicklist is updated (same event that Vue receives)
	 */
	public handleNamesEvent(data: {id: number; users: User[]}): void {
		const found = this.findChannel(data.id);
		if (!found) {
			log.warn(`${colors.yellow("[Node->WeeChat]")} Channel ${data.id} not found for names event`);
			return;
		}

		const {network, channel} = found;
		const bufferPtr = this.getBufferPointer(data.id);

		log.debug(`${colors.cyan("[Node->WeeChat]")} names event: ${channel.name} (${data.users.length} users)`);

		// Emit nicklist_diff event for WeeChat clients
		this.emit("nicklist_diff", {
			bufferPtr,
			networkUuid: network.uuid,
			channelId: data.id,
			users: data.users,
		});
	}

	/**
	 * Handle 'join' event from IrssiClient
	 * This is called when a new channel is opened (same event that Vue receives)
	 */
	public handleJoinEvent(data: {network: string; chan: any; index: number; shouldOpen: boolean}): void {
		const network = this.irssiClient.networks.find((n) => n.uuid === data.network);
		if (!network) {
			log.warn(`${colors.yellow("[Node->WeeChat]")} Network ${data.network} not found for join event`);
			return;
		}

		const channel = network.channels.find((c) => c.id === data.chan.id);
		if (!channel) {
			log.warn(`${colors.yellow("[Node->WeeChat]")} Channel ${data.chan.id} not found for join event`);
			return;
		}

		const bufferPtr = this.getBufferPointer(data.chan.id);

		log.info(`${colors.cyan("[Node->WeeChat]")} join event: ${channel.name} on ${network.name}`);

		// Emit buffer_opened event for WeeChat clients
		this.emit("buffer_opened", {
			bufferPtr,
			networkUuid: network.uuid,
			channelId: data.chan.id,
			channel,
		});
	}

	/**
	 * Handle 'part' event from IrssiClient
	 * This is called when a channel is closed (same event that Vue receives)
	 */
	public handlePartEvent(data: {chan: number}): void {
		const bufferPtr = this.getBufferPointer(data.chan);

		log.info(`${colors.cyan("[Node->WeeChat]")} part event: channel ${data.chan}`);

		// Emit buffer_closing event for WeeChat clients
		this.emit("buffer_closing", {
			bufferPtr,
			channelId: data.chan,
		});
	}

	/**
	 * Handle 'topic' event from IrssiClient
	 * This is called when topic changes (same event that Vue receives)
	 */
	public handleTopicEvent(data: {chan: number; topic: string}): void {
		const found = this.findChannel(data.chan);
		if (!found) {
			log.warn(`${colors.yellow("[Node->WeeChat]")} Channel ${data.chan} not found for topic event`);
			return;
		}

		const {network, channel} = found;
		const bufferPtr = this.getBufferPointer(data.chan);

		log.debug(`${colors.cyan("[Node->WeeChat]")} topic event: ${channel.name}`);

		// Emit buffer_title_changed event for WeeChat clients
		this.emit("buffer_title_changed", {
			bufferPtr,
			networkUuid: network.uuid,
			channelId: data.chan,
			topic: data.topic,
		});
	}

	/**
	 * Handle 'activity_update' event from IrssiClient
	 * This is called when unread/highlight counters change (same event that Vue receives)
	 */
	public handleActivityUpdateEvent(data: {chan: number; unread: number; highlight: number}): void {
		const found = this.findChannel(data.chan);
		if (!found) {
			log.warn(`${colors.yellow("[Node->WeeChat]")} Channel ${data.chan} not found for activity_update event`);
			return;
		}

		const {network, channel} = found;
		const bufferPtr = this.getBufferPointer(data.chan);

		log.debug(`${colors.cyan("[Node->WeeChat]")} activity_update: ${channel.name} (unread=${data.unread}, highlight=${data.highlight})`);

		// Emit hotlist_changed event for WeeChat clients
		this.emit("hotlist_changed", {
			bufferPtr,
			networkUuid: network.uuid,
			channelId: data.chan,
			unread: data.unread,
			highlight: data.highlight,
		});
	}

	/**
	 * Load message history for a buffer from encrypted storage
	 * Emits buffer_line_added events for each message (for Lith)
	 *
	 * NOTE: This is ONLY called for Lith-style clients that DON'T request history via HData!
	 * Weechat-android requests history via HData, so this is skipped to avoid infinite loop.
	 */
	async loadMessagesForBuffer(bufferPtr: bigint, networkUuid: string, channelName: string): Promise<void> {
		if (!this.irssiClient.messageStorage) {
			log.warn(`${colors.yellow("[Node->WeeChat]")} No message storage available, skipping history load`);
			return;
		}

		try {
			log.info(`${colors.cyan("[Node->WeeChat]")} Loading message history for ${channelName} (${networkUuid})`);

			// Load last 100 messages from encrypted storage
			const messages = await this.irssiClient.messageStorage.getLastMessages(
				networkUuid,
				channelName,
				100
			);

			log.info(`${colors.cyan("[Node->WeeChat]")} Loaded ${messages.length} messages for ${channelName}`);

			// Emit buffer_line_added for each message (for Lith)
			for (const msg of messages) {
				// Assign ID to message (same as IrssiClient does)
				msg.id = this.irssiClient.nextMessageId();

				// Emit buffer_line_added event
				this.emit("buffer_line_added", {
					bufferPtr,
					networkUuid,
					channelId: 0, // Not used for history
					channelName,
					msg,
					unread: 0,
					highlight: 0,
				});
			}

			log.info(`${colors.green("[Node->WeeChat]")} ✅ Sent ${messages.length} history messages for ${channelName}`);
		} catch (error) {
			log.error(`${colors.red("[Node->WeeChat]")} Failed to load messages for ${channelName}: ${error}`);
		}
	}

	/**
	 * Load message history for all buffers
	 * Called after sync to send initial message history to Lith
	 */
	async loadAllMessages(): Promise<void> {
		log.info(`${colors.cyan("[Node->WeeChat]")} Loading message history for all buffers...`);

		for (const network of this.irssiClient.networks) {
			for (const channel of network.channels) {
				// Skip lobby
				if (channel.type === ChanType.LOBBY) {
					continue;
				}

				const bufferPtr = this.getBufferPointer(channel.id);
				await this.loadMessagesForBuffer(bufferPtr, network.uuid, channel.name);
			}
		}

		log.info(`${colors.green("[Node->WeeChat]")} ✅ Finished loading message history for all buffers`);
	}

	/**
	 * Build buffers HData (for initial sync)
	 * Uses data directly from IrssiClient.networks
	 */
	buildBuffersHData(id: string): WeeChatMessage {
		log.info(`${colors.cyan("[Node->WeeChat]")} Building buffers HData for id: ${id}`);
		const msg = new WeeChatMessage(id);

		const fields: HDataField[] = [
			{name: "id", type: "ptr"},
			{name: "number", type: "int"},
			{name: "name", type: "str"}, // Full name (plugin.name format)
			{name: "short_name", type: "str"},
			{name: "hidden", type: "int"}, // 0=visible, 1=hidden
			{name: "title", type: "str"},
			{name: "local_variables", type: "htb"}, // HASHTABLE (not string!)
		];

		const objects: HDataObject[] = [];
		let bufferNumber = 1;

		// Build buffer list from IrssiClient.networks
		for (const network of this.irssiClient.networks) {
			// Add server buffer
			const serverPtr = this.getBufferPointer(network.channels[0]?.id || 0);
			const serverLocalVars = {
				plugin: "irc",
				name: `server.${network.name}`,
				type: "server",
				server: network.name,
				channel: network.name,
				nick: network.nick || "",
			};

			objects.push({
				pointers: [serverPtr],
				values: {
					id: serverPtr,
					number: bufferNumber++,
					name: network.name, // Full name
					short_name: network.name,
					hidden: 0, // Not hidden
					title: network.serverTag || network.name,
					local_variables: serverLocalVars,
				},
			});

			// Add channel buffers
			for (const channel of network.channels) {
				const bufferPtr = this.getBufferPointer(channel.id);
				const isChannel = channel.type === ChanType.CHANNEL;
				const localVars = {
					plugin: "irc",
					name: `${network.name}.${channel.name}`,
					type: isChannel ? "channel" : "private",
					server: network.name,
					channel: channel.name,
					nick: network.nick || "",
				};

				objects.push({
					pointers: [bufferPtr],
					values: {
						id: bufferPtr,
						number: bufferNumber++,
						name: `${network.name}.${channel.name}`, // Full name (plugin.name format)
						short_name: channel.name,
						hidden: 0, // Not hidden
						title: channel.topic || "",
						local_variables: localVars,
					},
				});
			}
		}

		// Set prev/next pointers
		for (let i = 0; i < objects.length; i++) {
			objects[i].values.prev_buffer = i > 0 ? objects[i - 1].pointers[0] : 0n;
			objects[i].values.next_buffer = i < objects.length - 1 ? objects[i + 1].pointers[0] : 0n;
		}

		if (objects.length > 0) {
			log.info(`${colors.cyan("[Node->WeeChat]")} Sending ${objects.length} buffers in HData`);
			buildHData(msg, "buffer", fields, objects);
		} else {
			log.warn(`${colors.yellow("[Node->WeeChat]")} No buffers to send!`);
			buildEmptyHData(msg);
		}

		return msg;
	}

	/**
	 * Build lines HData (for history)
	 * Uses data directly from IrssiClient.networks
	 */
	buildLinesHData(id: string, bufferPtr: bigint, count: number = 100): WeeChatMessage {
		const msg = new WeeChatMessage(id);

		// bufferPtr is actually channel.id
		const channelId = Number(bufferPtr);
		const found = this.findChannel(channelId);

		if (!found) {
			buildEmptyHData(msg);
			return msg;
		}

		const {network, channel} = found;

		// Build line_data HData
		const fields: HDataField[] = [
			{name: "buffer", type: "ptr"},
			{name: "id", type: "ptr"},
			{name: "date", type: "tim"},
			{name: "date_usec", type: "int"},
			{name: "date_printed", type: "tim"},
			{name: "date_usec_printed", type: "int"},
			{name: "displayed", type: "chr"},
			{name: "notify_level", type: "int"},
			{name: "highlight", type: "chr"},
			{name: "tags_array", type: "arr", arrayType: "str"},
			{name: "prefix", type: "str"},
			{name: "message", type: "str"},
		];

		const objects: HDataObject[] = [];
		const messages = channel.messages.slice(-count);

		for (const m of messages) {
			const linePtr = generatePointer();
			const timestamp = Math.floor(m.time.getTime() / 1000);

			objects.push({
				pointers: [linePtr],
				values: {
					buffer: bufferPtr,
					id: linePtr,
					date: timestamp,
					date_usec: 0,
					date_printed: timestamp,
					date_usec_printed: 0,
					displayed: 1,
					notify_level: m.highlight ? 3 : 1,
					highlight: m.highlight ? 1 : 0,
					tags_array: this.buildMessageTags(m),
					prefix: m.from?.nick || "",
					message: m.text,
				},
			});
		}

		if (objects.length > 0) {
			buildHData(msg, "line_data", fields, objects);
		} else {
			buildEmptyHData(msg);
		}

		return msg;
	}

	/**
	 * Build message tags (for WeeChat line metadata)
	 */
	private buildMessageTags(msg: Msg): string[] {
		const tags: string[] = [];

		// Add message type tag
		switch (msg.type) {
			case "message":
				tags.push("irc_privmsg");
				break;
			case "action":
				tags.push("irc_action");
				break;
			case "notice":
				tags.push("irc_notice");
				break;
			case "join":
				tags.push("irc_join");
				break;
			case "part":
				tags.push("irc_part");
				break;
			case "quit":
				tags.push("irc_quit");
				break;
			case "nick":
				tags.push("irc_nick");
				break;
		}

		// Add nick tag
		if (msg.from?.nick) {
			tags.push(`nick_${msg.from.nick}`);
		}

		// Add self tag
		if (msg.self) {
			tags.push("self_msg");
		}

		return tags;
	}

	/**
	 * Get all networks (for WeeChat commands)
	 */
	getNetworks(): NetworkData[] {
		return this.irssiClient.networks;
	}

	/**
	 * Find channel by buffer pointer
	 * Reverses the pointer calculation: channelId = (bufferPtr - BASE_ADDRESS) / 0x1000
	 * Returns buffer-like object for compatibility with old code
	 */
	getBufferByPointer(bufferPtr: bigint): any | null {
		// Reverse the pointer calculation
		const BASE_ADDRESS = 0x8690000000n;
		const channelId = Number((bufferPtr - BASE_ADDRESS) / 0x1000n);

		const found = this.findChannel(channelId);

		if (!found) {
			return null;
		}

		const {network, channel} = found;

		// Return buffer-like object for compatibility
		return {
			pointer: bufferPtr,
			fullName: `${network.name}.${channel.name}`,
			shortName: channel.name,
			type: channel.type === ChanType.CHANNEL ? "channel" : "private",
			title: channel.topic || "",
			networkUuid: network.uuid,
			channelId: channel.id,
			network,
			channel,
		};
	}
}

