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
import log from "../log.js";
import colors from "chalk";
import {WeeChatMessage, OBJ_HDATA, OBJ_STRING} from "./weechatProtocol.js";
import {
	buildHData,
	buildEmptyHData,
	HDataField,
	HDataObject,
	stringToPointer,
	generatePointer,
} from "./weechatHData.js";
import {IrssiClient} from "../irssiClient.js";
import {NetworkData} from "../feWebClient/feWebAdapter.js";
import Chan from "../models/chan.js";
import Msg from "../models/msg.js";
import User from "../models/user.js";
import {ChanType} from "../../shared/types/chan.js";

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

		log.info(
			`${colors.cyan("[Node->WeeChat]")} Adapter initialized for user ${irssiClient.name}`
		);
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
	 * Convert buffer pointer back to channel ID (reverse of getBufferPointer)
	 */
	public getChannelIdFromPointer(bufferPtr: bigint): number {
		const BASE_ADDRESS = 0x8690000000n;
		return Number((bufferPtr - BASE_ADDRESS) / 0x1000n);
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
			log.warn(
				`${colors.yellow("[Node->WeeChat]")} Channel ${data.chan} not found for msg event`
			);
			return;
		}

		const {network, channel} = found;
		const bufferPtr = this.getBufferPointer(data.chan);

		log.debug(
			`${colors.cyan("[Node->WeeChat]")} msg event: ${channel.name} on ${network.name}`
		);

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
		if (
			data.msg.type === "join" ||
			data.msg.type === "kick" ||
			data.msg.type === "part" ||
			data.msg.type === "quit"
		) {
			log.info(
				`${colors.cyan(
					"[Node->WeeChat]"
				)} ${data.msg.type.toUpperCase()} detected - sending nicklist_diff for ${
					channel.name
				}`
			);

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
			log.warn(
				`${colors.yellow("[Node->WeeChat]")} Channel ${data.id} not found for names event`
			);
			return;
		}

		const {network, channel} = found;
		const bufferPtr = this.getBufferPointer(data.id);

		log.debug(
			`${colors.cyan("[Node->WeeChat]")} names event: ${channel.name} (${
				data.users.length
			} users)`
		);

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
	public handleJoinEvent(data: {
		network: string;
		chan: any;
		index: number;
		shouldOpen: boolean;
	}): void {
		const network = this.irssiClient.networks.find((n) => n.uuid === data.network);

		if (!network) {
			log.warn(
				`${colors.yellow("[Node->WeeChat]")} Network ${
					data.network
				} not found for join event`
			);
			return;
		}

		const channel = network.channels.find((c) => c.id === data.chan.id);

		if (!channel) {
			log.warn(
				`${colors.yellow("[Node->WeeChat]")} Channel ${
					data.chan.id
				} not found for join event`
			);
			return;
		}

		const bufferPtr = this.getBufferPointer(data.chan.id);

		log.info(
			`${colors.cyan("[Node->WeeChat]")} join event: ${channel.name} on ${network.name}`
		);

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
			log.warn(
				`${colors.yellow("[Node->WeeChat]")} Channel ${data.chan} not found for topic event`
			);
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
	public handleActivityUpdateEvent(data: {
		chan: number;
		unread: number;
		highlight: number;
	}): void {
		const found = this.findChannel(data.chan);

		if (!found) {
			log.warn(
				`${colors.yellow("[Node->WeeChat]")} Channel ${
					data.chan
				} not found for activity_update event`
			);
			return;
		}

		const {network, channel} = found;
		const bufferPtr = this.getBufferPointer(data.chan);

		log.debug(
			`${colors.cyan("[Node->WeeChat]")} activity_update: ${channel.name} (unread=${
				data.unread
			}, highlight=${data.highlight})`
		);

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
	async loadMessagesForBuffer(
		bufferPtr: bigint,
		networkUuid: string,
		channelName: string
	): Promise<void> {
		if (!this.irssiClient.messageStorage) {
			log.warn(
				`${colors.yellow(
					"[Node->WeeChat]"
				)} No message storage available, skipping history load`
			);
			return;
		}

		try {
			log.info(
				`${colors.cyan(
					"[Node->WeeChat]"
				)} Loading message history for ${channelName} (${networkUuid})`
			);

			// Load last 100 messages from encrypted storage
			const messages = await this.irssiClient.messageStorage.getLastMessages(
				networkUuid,
				channelName,
				100
			);

			log.info(
				`${colors.cyan("[Node->WeeChat]")} Loaded ${
					messages.length
				} messages for ${channelName}`
			);

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

			log.info(
				`${colors.green("[Node->WeeChat]")} ✅ Sent ${
					messages.length
				} history messages for ${channelName}`
			);
		} catch (error) {
			log.error(
				`${colors.red(
					"[Node->WeeChat]"
				)} Failed to load messages for ${channelName}: ${error}`
			);
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

		log.info(
			`${colors.green("[Node->WeeChat]")} ✅ Finished loading message history for all buffers`
		);
	}

	/**
	 * Build buffers HData (for initial sync)
	 * Uses data directly from IrssiClient.networks
	 */
	buildBuffersHData(id: string): WeeChatMessage {
		log.info(`${colors.cyan("[Node->WeeChat]")} Building buffers HData for id: ${id}`);
		const msg = new WeeChatMessage(id);

		const fields: HDataField[] = [
			{name: "number", type: "int"},
			{name: "full_name", type: "str"},
			{name: "short_name", type: "str"},
			{name: "type", type: "int"},
			{name: "title", type: "str"},
			{name: "nicklist", type: "int"},
			{name: "local_variables", type: "htb"},
			{name: "notify", type: "int"},
			{name: "hidden", type: "int"},
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
					number: bufferNumber++,
					full_name: `irc.server.${network.name}`,
					short_name: network.name,
					type: 0, // server
					title: network.serverTag || network.name,
					nicklist: 0,
					local_variables: serverLocalVars,
					notify: 3,
					hidden: 0,
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
						number: bufferNumber++,
						full_name: `irc.${network.name}.${channel.name}`,
						short_name: channel.name,
						type: isChannel ? 1 : 2, // 1=channel, 2=private (approx)
						title: channel.topic || "",
						nicklist: isChannel ? 1 : 0,
						local_variables: localVars,
						notify: 3,
						hidden: 0,
					},
				});
			}
		}

		// Set prev/next pointers
		for (let i = 0; i < objects.length; i++) {
			objects[i].values.prev_buffer = i > 0 ? objects[i - 1].pointers[0] : 0n;
			objects[i].values.next_buffer =
				i < objects.length - 1 ? objects[i + 1].pointers[0] : 0n;
		}

		if (objects.length > 0) {
			log.info(
				`${colors.cyan("[Node->WeeChat]")} Sending ${objects.length} buffers in HData`
			);
			buildHData(msg, "buffer", fields, objects);
		} else {
			log.warn(`${colors.yellow("[Node->WeeChat]")} No buffers to send!`);
			buildEmptyHData(msg);
		}

		return msg;
	}

	/**
	 * Build bulk lines HData (for weechat-android)
	 * Returns last N lines for ALL buffers
	 * Format: buffer:gui_buffers(*)/own_lines/last_line(-N)/data id,buffer,displayed
	 */
	buildBulkLinesHData(id: string, count: number = 25, keys: string = ""): WeeChatMessage {
		log.warn(
			`${colors.magenta(
				"[Node->WeeChat DEBUG]"
			)} 📜 buildBulkLinesHData: id="${id}", count=${count}, keys="${keys}"`
		);

		const msg = new WeeChatMessage(id);

		// IMPORTANT: Only send fields that client requested!
		// Weechat-android requests: "id,buffer,displayed" (3 fields)
		// Lith requests: all fields
		// Parse requested keys
		const requestedKeys = keys ? keys.split(",").map((k) => k.trim()) : [];
		log.info(
			`${colors.cyan("[Node->WeeChat DEBUG]")} Requested keys: ${requestedKeys.join(", ")}`
		);

		// Build fields based on requested keys
		// If no keys specified, send all fields (Lith style)
		let fields: HDataField[] = [];

		const typeForKey = (k: string): HDataField => {
			switch (k) {
				case "buffer":
					return {name: "buffer", type: "ptr"};
				case "id":
					return {name: "id", type: "int"}; // WeeChat >=4.4 uses int; android handles both
				case "date":
					return {name: "date", type: "tim"};
				case "date_usec":
					return {name: "date_usec", type: "int"};
				case "date_printed":
					return {name: "date_printed", type: "tim"};
				case "date_usec_printed":
					return {name: "date_usec_printed", type: "int"};
				case "displayed":
					return {name: "displayed", type: "chr"};
				case "notify_level":
					return {name: "notify_level", type: "int"};
				case "notify":
					return {name: "notify", type: "int"};
				case "highlight":
					return {name: "highlight", type: "chr"};
				case "tags_array":
					return {name: "tags_array", type: "arr", arrayType: "str"};
				case "prefix":
					return {name: "prefix", type: "str"};
				case "message":
					return {name: "message", type: "str"};
				default:
					return {name: k as any, type: "str"};
			}
		};

		if (requestedKeys.length > 0) {
			// preserve order EXACTLY as requested by client
			fields = requestedKeys.map(typeForKey);
		} else {
			// default full set (Lith)
			fields = [
				typeForKey("buffer"),
				typeForKey("id"),
				typeForKey("date"),
				typeForKey("date_usec"),
				typeForKey("date_printed"),
				typeForKey("date_usec_printed"),
				typeForKey("displayed"),
				typeForKey("notify_level"),
				typeForKey("highlight"),
				typeForKey("tags_array"),
				typeForKey("prefix"),
				typeForKey("message"),
			];
		}

		const objects: HDataObject[] = [];
		let totalLines = 0;

		// Iterate through all networks and channels
		for (const network of this.irssiClient.networks) {
			for (const channel of network.channels) {
				// Skip lobby
				if (channel.type === ChanType.LOBBY) {
					continue;
				}

				const bufferPtr = this.getBufferPointer(channel.id);
				// TEMPORARY: Limit to 5 lines per buffer to debug crash
				const actualCount = Math.min(count, 5);
				const messages = channel.messages.slice(-actualCount);

				if (messages.length === 0) {
					continue; // Skip empty buffers
				}

				// Generate pointers for hpath: buffer/own_lines/last_line/data (EXACT per spec!)
				// We need 4 pointers: buffer, own_lines, last_line, data
				const ownLinesPtr = stringToPointer(`${bufferPtr}-own_lines`);

				for (const m of messages) {
					const lastLinePtr = stringToPointer(
						`${bufferPtr}-last_line-${m.id || Date.now()}`
					);
					const dataPtr = stringToPointer(`${bufferPtr}-data-${m.id || Date.now()}`);
					const timestamp = Math.floor(m.time.getTime() / 1000);

					// Build values object with ONLY requested fields
					const values: Record<string, any> = {};

					if (requestedKeys.length === 0 || requestedKeys.includes("buffer")) {
						values.buffer = bufferPtr;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("id")) {
						// Use a simple increasing integer as line id (per message)
						values.id = totalLines; // int id
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("date")) {
						values.date = timestamp;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("date_usec")) {
						values.date_usec = 0;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("date_printed")) {
						values.date_printed = timestamp;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("date_usec_printed")) {
						values.date_usec_printed = 0;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("displayed")) {
						values.displayed = 1;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("notify_level")) {
						values.notify_level = m.highlight ? 3 : 1;
					}

					if (requestedKeys.includes("notify")) {
						values.notify = m.highlight ? 3 : 1;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("highlight")) {
						values.highlight = m.highlight ? 1 : 0;
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("tags_array")) {
						values.tags_array = this.buildMessageTags(m);
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("prefix")) {
						values.prefix = m.from?.nick || "";
					}

					if (requestedKeys.length === 0 || requestedKeys.includes("message")) {
						values.message = m.text;
					}

					objects.push({
						// CRITICAL: Number of pointers MUST match HPath levels!
						// HPath = "buffer/own_lines/last_line/data" → 4 pointers (EXACT per spec!)
						pointers: [bufferPtr, ownLinesPtr, lastLinePtr, dataPtr],
						values,
					});
					totalLines++;
				}
			}
		}

		if (objects.length > 0) {
			// CRITICAL: hpath MUST match the request format EXACTLY!
			// Weechat-android requests: buffer:gui_buffers(*)/own_lines/last_line(-N)/data
			// So hpath MUST be: buffer/own_lines/last_line/data (NOT buffer/lines/line/line_data!)
			buildHData(msg, "buffer/own_lines/last_line/data", fields, objects);
			log.info(
				`${colors.green(
					"[Node->WeeChat DEBUG]"
				)} ✅ Built ${totalLines} lines for ${this.irssiClient.networks.reduce(
					(sum, n) => sum + n.channels.length - 1,
					0
				)} buffers`
			);
		} else {
			buildEmptyHData(msg);
			log.warn(`${colors.yellow("[Node->WeeChat DEBUG]")} ⚠️ No messages to send (bulk)`);
		}

		return msg;
	}

	/**
	 * Build last read lines HData (weechat-android ONLY)
	 * Request: buffer:gui_buffers(*)/own_lines/last_read_line/data id,buffer
	 *
	 * Response format (EXACT per spec):
	 * - HPath: buffer/own_lines/last_read_line/data (4 LEVELS!)
	 * - P-path: [buffer_ptr, own_lines_ptr, last_read_line_ptr, data_ptr] (4 pointers)
	 * - Fields: id:int, buffer:ptr (ONLY 2 fields, EXACT order!)
	 */
	buildLastReadLinesHData(id: string, requestedKeys: string): WeeChatMessage {
		log.info(
			`${colors.magenta(
				"[Node->WeeChat]"
			)} 📖 Building last read lines HData, keys="${requestedKeys}"`
		);

		const msg = new WeeChatMessage(id);
		const keys = requestedKeys.split(",").map((k) => k.trim());

		// Validate keys (MUST be exactly: id,buffer)
		if (keys.length !== 2 || keys[0] !== "id" || keys[1] !== "buffer") {
			log.error(
				`${colors.red(
					"[Node->WeeChat]"
				)} ❌ Invalid keys for last_read_lines: "${requestedKeys}" (expected: "id,buffer")`
			);
			buildEmptyHData(msg);
			return msg;
		}

		// Build HData header
		const fields: HDataField[] = [
			{name: "id", type: "int"}, // WeeChat >= 4.4.0
			{name: "buffer", type: "ptr"},
		];

		const objects: HDataObject[] = [];

		// For each buffer, add last read line (if exists)
		for (const network of this.irssiClient.networks) {
			for (const channel of network.channels) {
				if (channel.id === 0) continue; // Skip network buffer

				const bufferPtr = BigInt(channel.id);

				// Get last read line from unread markers
				const unreadMarker = this.irssiClient.unreadMarkers.get(
					`${network.uuid}/${channel.name}`
				);
				if (!unreadMarker || unreadMarker.lastReadTime === 0) continue;

				// Generate line ID from last read timestamp
				const lineIdInt = Math.abs(unreadMarker.lastReadTime % 2147483647);

				if (lineIdInt === 0) continue; // Skip if no valid line ID

				// Generate pointers (4 levels!)
				const ownLinesPtr = stringToPointer(`${bufferPtr}-own_lines`);
				const lastReadLinePtr = stringToPointer(`${bufferPtr}-last_read_line-${lineIdInt}`);
				const dataPtr = stringToPointer(`${bufferPtr}-data-${lineIdInt}`);

				const values: Record<string, any> = {
					id: lineIdInt,
					buffer: bufferPtr,
				};

				objects.push({
					pointers: [bufferPtr, ownLinesPtr, lastReadLinePtr, dataPtr], // 4 pointers!
					values,
				});
			}
		}

		if (objects.length > 0) {
			// CRITICAL: HPath MUST be 4 levels!
			buildHData(msg, "buffer/own_lines/last_read_line/data", fields, objects);
			log.info(
				`${colors.green("[Node->WeeChat]")} ✅ Built ${objects.length} last read lines`
			);
		} else {
			buildEmptyHData(msg);
			log.warn(`${colors.yellow("[Node->WeeChat]")} ⚠️ No last read lines to send`);
		}

		return msg;
	}

	/**
	 * Build per-buffer lines HData (weechat-android ONLY)
	 * Request: buffer:0x12345/own_lines/last_line(-100)/data id,date,displayed,prefix,message,highlight,notify,tags_array
	 *
	 * CRITICAL: Loads from encrypted storage (like Lith)!
	 *
	 * Response format (EXACT per spec):
	 * - HPath: buffer/own_lines/last_line/data (4 LEVELS!)
	 * - P-path: [buffer_ptr, own_lines_ptr, last_line_ptr, data_ptr] (4 pointers)
	 * - Fields: id,date,displayed,prefix,message,highlight,notify,tags_array (8 fields, EXACT order!)
	 */
	async buildPerBufferLinesHData(
		id: string,
		bufferPtr: bigint,
		count: number,
		requestedKeys: string
	): Promise<WeeChatMessage> {
		log.info(
			`${colors.magenta(
				"[Node->WeeChat]"
			)} 📄 Building per-buffer lines HData: buffer=${bufferPtr}, count=${count}, keys="${requestedKeys}"`
		);

		const msg = new WeeChatMessage(id);

		// Default keys if not specified (Lith sends empty keys!)
		const expectedKeys = [
			"id",
			"date",
			"displayed",
			"prefix",
			"message",
			"highlight",
			"notify",
			"tags_array",
		];
		const keys =
			requestedKeys.trim() === ""
				? expectedKeys
				: requestedKeys.split(",").map((k) => k.trim());

		// Validate keys (MUST be exactly: id,date,displayed,prefix,message,highlight,notify,tags_array)
		if (keys.length !== 8 || !keys.every((k, i) => k === expectedKeys[i])) {
			log.error(
				`${colors.red(
					"[Node->WeeChat]"
				)} ❌ Invalid keys for per-buffer lines: "${requestedKeys}" (expected: "${expectedKeys.join(
					","
				)}")`
			);
			buildEmptyHData(msg);
			return msg;
		}

		// Find channel (convert bufferPtr back to channelId)
		const channelId = this.getChannelIdFromPointer(bufferPtr);
		const found = this.findChannel(channelId);

		if (!found) {
			log.error(
				`${colors.red(
					"[Node->WeeChat]"
				)} ❌ Channel not found: bufferPtr=${bufferPtr}, channelId=${channelId}`
			);
			buildEmptyHData(msg);
			return msg;
		}

		const {network, channel} = found;

		// CRITICAL FIX: Load messages from storage (like Lith does)!
		let messages: any[] = [];

		if (this.irssiClient.messageStorage) {
			log.info(
				`${colors.cyan("[Node->WeeChat]")} 📜 Loading ${count} messages from storage for ${
					channel.name
				}...`
			);
			messages = await this.irssiClient.messageStorage.getLastMessages(
				network.uuid,
				channel.name,
				count
			);
			log.info(
				`${colors.green("[Node->WeeChat]")} ✅ Loaded ${
					messages.length
				} messages from storage`
			);

			// CRITICAL: Weechat-android expects messages in REVERSE order (newest first)!
			// See WEECHAT_ANDROID_PROTOCOL.md line 423: obj.forEachReversed
			messages = messages.reverse();
			log.debug(
				`${colors.cyan(
					"[Node->WeeChat]"
				)} 🔄 Reversed messages for weechat-android (newest first)`
			);
		} else {
			log.warn(
				`${colors.yellow(
					"[Node->WeeChat]"
				)} ⚠️ No message storage, using in-memory messages (${channel.messages.length})`
			);
			messages = channel.messages.slice(-count).reverse(); // Also reverse for consistency
		}

		// Build HData header (EXACT order per spec!)
		const fields: HDataField[] = [
			{name: "id", type: "int"}, // WeeChat >= 4.4.0
			{name: "date", type: "tim"},
			{name: "displayed", type: "chr"},
			{name: "prefix", type: "str"},
			{name: "message", type: "str"},
			{name: "highlight", type: "chr"},
			{name: "notify", type: "int"}, // NOT notify_level!
			{name: "tags_array", type: "arr", arrayType: "str"},
		];

		const objects: HDataObject[] = [];
		// messages already loaded from storage above

		// Generate pointers (4 levels!)
		const ownLinesPtr = stringToPointer(`${bufferPtr}-own_lines`);

		for (const m of messages) {
			const lineIdInt = (() => {
				const id: string | number = m.id || Date.now();
				const raw =
					typeof id === "string"
						? parseInt((id as string).split("-")[0], 10)
						: Number(id);
				return Number.isFinite(raw)
					? Math.abs(raw % 2147483647)
					: Math.floor(Date.now() % 2147483647);
			})();

			const lastLinePtr = stringToPointer(`${bufferPtr}-last_line-${lineIdInt}`);
			const dataPtr = stringToPointer(`${bufferPtr}-data-${lineIdInt}`);

			const timestamp = Math.floor(m.time.getTime() / 1000);
			const notifyLevel = m.highlight
				? 3
				: m.type === "join" || m.type === "part" || m.type === "quit"
					? 0
					: 1;

			// Format message text based on type (like Vue does)
			const {prefix, message} = this.formatMessageForWeechat(m);

			// Build values (EXACT order per spec!)
			const values: Record<string, any> = {
				id: lineIdInt,
				date: timestamp,
				displayed: 1,
				prefix,
				message,
				highlight: m.highlight ? 1 : 0,
				notify: notifyLevel,
				tags_array: this.buildMessageTags(m),
			};

			objects.push({
				pointers: [bufferPtr, ownLinesPtr, lastLinePtr, dataPtr], // 4 pointers!
				values,
			});
		}

		if (objects.length > 0) {
			// CRITICAL: HPath MUST be 4 levels!
			buildHData(msg, "buffer/own_lines/last_line/data", fields, objects);
			log.info(
				`${colors.green("[Node->WeeChat]")} ✅ Built ${
					objects.length
				} lines for buffer ${bufferPtr}`
			);
		} else {
			buildEmptyHData(msg);
			log.warn(`${colors.yellow("[Node->WeeChat]")} ⚠️ No messages for buffer ${bufferPtr}`);
		}

		return msg;
	}

	/**
	 * Build lines HData for a single buffer with requested keys (weechat-android style)
	 * Example request keys: "id,date,displayed,prefix,message,highlight,notify,tags_array"
	 */
	buildBufferOwnLinesHData(
		id: string,
		bufferPtr: bigint,
		count: number = 100,
		keys: string = ""
	): WeeChatMessage {
		log.warn(
			`${colors.magenta(
				"[Node->WeeChat DEBUG]"
			)} 📜 buildBufferOwnLinesHData: id="${id}", bufferPtr=${bufferPtr.toString(
				16
			)}, count=${count}, keys="${keys}"`
		);
		const msg = new WeeChatMessage(id);

		// Resolve buffer and channel from pointer
		const buffer = this.getBufferByPointer(bufferPtr);

		if (!buffer || !buffer.channel) {
			buildEmptyHData(msg);
			return msg;
		}

		const channel = buffer.channel as Chan;

		// Parse requested keys
		const requestedKeys = keys ? keys.split(",").map((k) => k.trim()) : [];

		const typeForKey = (k: string): HDataField => {
			switch (k) {
				case "buffer":
					return {name: "buffer", type: "ptr"};
				case "id":
					return {name: "id", type: "int"};
				case "date":
					return {name: "date", type: "tim"};
				case "date_usec":
					return {name: "date_usec", type: "int"};
				case "date_printed":
					return {name: "date_printed", type: "tim"};
				case "date_usec_printed":
					return {name: "date_usec_printed", type: "int"};
				case "displayed":
					return {name: "displayed", type: "chr"};
				case "notify":
					return {name: "notify", type: "int"};
				case "notify_level":
					return {name: "notify_level", type: "int"};
				case "highlight":
					return {name: "highlight", type: "chr"};
				case "tags_array":
					return {name: "tags_array", type: "arr", arrayType: "str"};
				case "prefix":
					return {name: "prefix", type: "str"};
				case "message":
					return {name: "message", type: "str"};
				default:
					return {name: k as any, type: "str"};
			}
		};

		const fields: HDataField[] =
			requestedKeys.length > 0
				? requestedKeys.map(typeForKey)
				: [
						// default full set
						{name: "buffer", type: "ptr"},
						{name: "id", type: "int"},
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
		const linesPtr = generatePointer();
		let idx = 0;

		for (const m of messages) {
			const linePtr = generatePointer();
			const lineDataPtr = generatePointer();
			const ts = Math.floor(m.time.getTime() / 1000);
			const values: Record<string, any> = {};
			if (requestedKeys.length === 0 || requestedKeys.includes("buffer"))
				values.buffer = bufferPtr;
			if (requestedKeys.length === 0 || requestedKeys.includes("id")) values.id = idx++;
			if (requestedKeys.length === 0 || requestedKeys.includes("date")) values.date = ts;
			if (requestedKeys.length === 0 || requestedKeys.includes("date_usec"))
				values.date_usec = 0;
			if (requestedKeys.length === 0 || requestedKeys.includes("date_printed"))
				values.date_printed = ts;
			if (requestedKeys.length === 0 || requestedKeys.includes("date_usec_printed"))
				values.date_usec_printed = 0;
			if (requestedKeys.length === 0 || requestedKeys.includes("displayed"))
				values.displayed = 1;
			if (requestedKeys.includes("notify")) values.notify = m.highlight ? 3 : 1;
			if (requestedKeys.length === 0 || requestedKeys.includes("notify_level"))
				values.notify_level = m.highlight ? 3 : 1;
			if (requestedKeys.length === 0 || requestedKeys.includes("highlight"))
				values.highlight = m.highlight ? 1 : 0;
			if (requestedKeys.length === 0 || requestedKeys.includes("tags_array"))
				values.tags_array = this.buildMessageTags(m);
			if (requestedKeys.length === 0 || requestedKeys.includes("prefix"))
				values.prefix = m.from?.nick || "";
			if (requestedKeys.length === 0 || requestedKeys.includes("message"))
				values.message = m.text;

			objects.push({pointers: [bufferPtr, linesPtr, linePtr, lineDataPtr], values});
		}

		if (objects.length > 0) {
			buildHData(msg, "buffer/lines/line/line_data", fields, objects);
		} else {
			buildEmptyHData(msg);
		}

		return msg;
	}

	/**
	 * Build lines HData (for history - single buffer, Lith style)
	 * Uses data directly from IrssiClient.networks
	 * CRITICAL FIX: Now async - loads from DB if channel.messages is empty
	 */
	async buildLinesHData(
		id: string,
		bufferPtr: bigint,
		count: number = 100
	): Promise<WeeChatMessage> {
		// 🚨 DEBUG: Log buildLinesHData call
		log.warn(
			`${colors.magenta(
				"[Node->WeeChat DEBUG]"
			)} 📜 buildLinesHData: id="${id}", bufferPtr=${bufferPtr}, count=${count}`
		);

		const msg = new WeeChatMessage(id);

		// bufferPtr is actually channel.id
		const channelId = Number(bufferPtr);
		const found = this.findChannel(channelId);

		if (!found) {
			log.warn(
				`${colors.yellow(
					"[Node->WeeChat DEBUG]"
				)} ⚠️ Channel not found for bufferPtr=${bufferPtr}`
			);
			buildEmptyHData(msg);
			return msg;
		}

		const {network, channel} = found;

		// CRITICAL FIX: Load messages DIRECTLY from storage (not from channel.messages)!
		// channel.messages contains only real-time messages, history is in encrypted storage
		let messages: any[] = [];

		if (this.irssiClient.messageStorage) {
			log.info(
				`${colors.cyan(
					"[Node->WeeChat DEBUG]"
				)} 📜 Loading ${count} messages from storage for ${channel.name}...`
			);
			messages = await this.irssiClient.messageStorage.getLastMessages(
				network.uuid,
				channel.name,
				count
			);
			log.info(
				`${colors.green("[Node->WeeChat DEBUG]")} ✅ Loaded ${
					messages.length
				} messages from storage`
			);
		} else {
			log.warn(
				`${colors.yellow(
					"[Node->WeeChat DEBUG]"
				)} ⚠️ No message storage, using in-memory messages (${channel.messages.length})`
			);
			messages = channel.messages.slice(-count);
		}

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
		// messages already loaded from storage above

		for (const m of messages) {
			const linePtr = generatePointer();
			const timestamp = Math.floor(m.time.getTime() / 1000);

			// Format message text based on type (like Vue does)
			const {prefix, message} = this.formatMessageForWeechat(m);

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
					prefix,
					message,
				},
			});
		}

		if (objects.length > 0) {
			buildHData(msg, "line_data", fields, objects);
			log.info(
				`${colors.green("[Node->WeeChat DEBUG]")} ✅ Built ${objects.length} lines for ${
					channel.name
				}`
			);
		} else {
			buildEmptyHData(msg);
			log.warn(
				`${colors.yellow("[Node->WeeChat DEBUG]")} ⚠️ No messages to send for ${
					channel.name
				}`
			);
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
	 * Format message for WeeChat clients (like Vue does)
	 * Returns {prefix, message} formatted for JOIN/PART/QUIT/KICK/MODE etc.
	 */
	public formatMessageForWeechat(msg: Msg): {prefix: string; message: string} {
		const nick = msg.from?.nick || "";
		const hostmask = msg.hostmask || "";

		switch (msg.type) {
			case "join":
				return {
					prefix: "-->",
					message: `${nick} (${hostmask}) has joined the channel`,
				};

			case "part":
				return {
					prefix: "<--",
					message: `${nick} (${hostmask}) has left the channel${
						msg.text ? ` (${msg.text})` : ""
					}`,
				};

			case "quit":
				return {
					prefix: "<--",
					message: `${nick} (${hostmask}) has quit${msg.text ? ` (${msg.text})` : ""}`,
				};

			case "kick":
				return {
					prefix: "<--",
					message: `${msg.target?.nick || "?"} was kicked by ${nick}${
						msg.text ? ` (${msg.text})` : ""
					}`,
				};

			case "mode":
			case "mode_channel":
				return {
					prefix: "--",
					message: `${nick} sets mode ${msg.text || ""}`,
				};

			case "nick":
				return {
					prefix: "--",
					message: `${nick} is now known as ${msg.new_nick || msg.text || "?"}`,
				};

			case "topic":
				return {
					prefix: "--",
					message: nick
						? `${nick} has changed the topic to: ${msg.text || ""}`
						: `The topic is: ${msg.text || ""}`,
				};

			case "action":
				return {
					prefix: "*",
					message: `${nick} ${msg.text || ""}`,
				};

			case "notice":
				return {
					prefix: `-${nick}-`,
					message: msg.text || "",
				};

			case "message":
			default:
				return {
					prefix: nick,
					message: msg.text || "",
				};
		}
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
