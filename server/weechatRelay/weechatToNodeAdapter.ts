/**
 * WeeChat to Node Adapter
 *
 * Translates WeeChat Relay commands to Node (IrssiClient) commands.
 *
 * Key command mappings:
 * - hdata buffer:gui_buffers(*) -> Send buffer list from IrssiClient.networks
 * - hdata buffer:0xXXX/lines/last_line(-N)/data -> Send message history from Chan.messages
 * - input 0xXXX /command -> Send IRC command via IrssiClient.handleInput()
 * - input 0xXXX message -> Send IRC message via IrssiClient.handleInput()
 * - sync * buffer,nicklist -> Subscribe to updates
 */

import {EventEmitter} from "events";
import log from "../log.js";
import chalk from "chalk";
import {WeeChatMessage, OBJ_STRING, OBJ_HDATA, OBJ_INFO} from "./weechatProtocol.js";
import {buildEmptyHData, stringToPointer} from "./weechatHData.js";
import {IrssiClient} from "../irssiClient.js";
import {NodeToWeeChatAdapter} from "./nodeToWeechatAdapter.js";
import {WeeChatRelayClient} from "./weechatRelayClient.js";

/**
 * WeeChat to Node Adapter
 *
 * Handles WeeChat Relay commands from Lith clients and translates them to Node (IrssiClient) operations.
 */
export class WeeChatToNodeAdapter extends EventEmitter {
	private irssiClient: IrssiClient;
	private nodeAdapter: NodeToWeeChatAdapter;
	private relayClient: WeeChatRelayClient;
	private syncedBuffers: Set<bigint> = new Set();
	private syncAll: boolean = true; // Default to true - sync all buffers automatically
	private eventHandlers: Map<string, (...args: any[]) => void> = new Map(); // Track handlers for cleanup
	private clientUsesHDataHistory: boolean = false; // Detect if client is weechat-android (uses bulk HData requests)

	constructor(
		irssiClient: IrssiClient,
		nodeAdapter: NodeToWeeChatAdapter,
		relayClient: WeeChatRelayClient
	) {
		super();
		this.irssiClient = irssiClient;
		this.nodeAdapter = nodeAdapter;
		this.relayClient = relayClient;

		this.setupRelayHandlers();
		this.setupNodeAdapterHandlers();

		// Setup cleanup on client disconnect
		this.relayClient.once("close", () => {
			log.warn(
				`${chalk.red("[WeeChat->Node]")} 🔴 Client close event received, calling cleanup()`
			);
			this.cleanup();
		});

		// Log that we're syncing all buffers by default
		log.info(
			`${chalk.green(
				"[WeeChat->Node]"
			)} ✅ Auto-syncing ALL buffers (syncAll=true by default) - client: ${this.relayClient.getId()}`
		);
	}

	/**
	 * Cleanup event handlers when client disconnects
	 */
	private cleanup(): void {
		log.info(
			`${chalk.yellow(
				"[WeeChat->Node]"
			)} Cleaning up event handlers for disconnected client: ${this.relayClient.getId()}`
		);
		log.info(
			`${chalk.yellow("[WeeChat->Node]")} Removing ${
				this.eventHandlers.size
			} event handlers from nodeAdapter`
		);

		// Remove all event handlers from nodeAdapter
		for (const [key, handler] of this.eventHandlers) {
			// Extract event name from key (format: "event_N")
			const eventName = key.substring(0, key.lastIndexOf("_"));
			log.debug(
				`${chalk.yellow("[WeeChat->Node]")} Removing handler: ${key} (event: ${eventName})`
			);
			this.nodeAdapter.removeListener(eventName, handler);
		}

		this.eventHandlers.clear();

		// Remove all listeners from this adapter
		this.removeAllListeners();

		log.info(
			`${chalk.green(
				"[WeeChat->Node]"
			)} ✅ Cleanup complete for client: ${this.relayClient.getId()}`
		);
	}

	/**
	 * Setup handlers for relay client commands
	 */
	private setupRelayHandlers(): void {
		this.relayClient.on("command", (data: {command: string; id: string; args: string}) => {
			log.info(
				`${chalk.cyan("[WeeChat->Node]")} Received command: ${data.command}, id: ${data.id}`
			);

			switch (data.command) {
				case "hdata":
					this.handleHData(data.id, data.args);
					break;
				case "info":
					this.handleInfo(data.id, data.args);
					break;
				case "infolist":
					this.handleInfoList(data.id, data.args);
					break;
				case "nicklist":
					this.handleNicklist(data.id, data.args);
					break;
				case "input":
					this.handleInput(data.id, data.args);
					break;
				case "sync":
					this.handleSync(data.id, data.args);
					break;
				case "desync":
					this.handleDesync(data.id, data.args);
					break;
				case "ping":
					// Ping is handled directly by WeeChatRelayClient
					break;
				case "test":
					this.handleTest(data.id, data.args);
					break;
			}
		});
	}

	/**
	 * Setup handlers for Node adapter events (to forward to WeeChat client)
	 * These are the same events that Vue frontend receives from IrssiClient
	 */
	private setupNodeAdapterHandlers(): void {
		// Helper to register handler and track it for cleanup
		const registerHandler = (event: string, handler: (...args: any[]) => void) => {
			this.nodeAdapter.on(event, handler);
			this.eventHandlers.set(event + "_" + this.eventHandlers.size, handler);
		};

		// buffer_opened: New channel opened
		registerHandler("buffer_opened", (data: any) => {
			if (this.syncAll || this.syncedBuffers.has(data.bufferPtr)) {
				this.sendBufferOpened(data);
			}
		});

		// buffer_closing: Channel closed
		registerHandler("buffer_closing", (data: any) => {
			if (this.syncAll || this.syncedBuffers.has(data.bufferPtr)) {
				this.sendBufferClosed(data);
			}
		});

		// buffer_line_added: New message
		registerHandler("buffer_line_added", (data: any) => {
			log.debug(
				`${chalk.cyan("[WeeChat->Node]")} buffer_line_added: buffer=${
					data.bufferPtr
				}, syncAll=${this.syncAll}`
			);

			if (this.syncAll || this.syncedBuffers.has(data.bufferPtr)) {
				// Extract buffer and msg from data
				const buffer = {
					pointer: data.bufferPtr,
					fullName: `buffer_${data.channelId}`,
					channelName: data.channelName || `#${data.channelId}`,
				};
				this.sendLineAdded(buffer, data.msg);
			}
		});

		// nicklist_diff: Nicklist update (users join/part/mode change)
		registerHandler("nicklist_diff", (data: any) => {
			log.debug(
				`${chalk.cyan("[WeeChat->Node]")} nicklist_diff: buffer=${data.bufferPtr}, users=${
					data.users.length
				}`
			);

			if (this.syncAll || this.syncedBuffers.has(data.bufferPtr)) {
				this.sendNicklistDiff(data);
			}
		});

		// buffer_title_changed: Topic changed
		registerHandler("buffer_title_changed", (data: any) => {
			if (this.syncAll || this.syncedBuffers.has(data.bufferPtr)) {
				this.sendBufferTitleChanged(data);
			}
		});

		// hotlist_changed: Unread/highlight changed
		registerHandler("hotlist_changed", (data: any) => {
			// Hotlist is global, always send
			this.sendHotlistChanged(data);
		});

		// line_data: Real-time message (for weechat-android compatibility)
		registerHandler("line_data", (data: any) => {
			// line_data is sent directly to relayClient, not through this adapter
			// This is handled in irssiClient.ts
		});
	}

	/**
	 * Handle hdata command
	 */
	private async handleHData(id: string, args: string): Promise<void> {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} HData request: ${args}`);

		// Parse hdata request
		// Format: "buffer:gui_buffers(*) id,number,name,..."
		// or: "buffer:0x12345/lines/last_line(-100)/data date,prefix,message,..."

		const spaceIdx = args.indexOf(" ");
		const path = spaceIdx > 0 ? args.substring(0, spaceIdx) : args;
		const keys = spaceIdx > 0 ? args.substring(spaceIdx + 1) : "";

		// DETECT weechat-android: uses bulk HData requests with specific fields
		// Example: "buffer:gui_buffers(*)/own_lines/last_line(-25)/data id,buffer,displayed"
		if (path.includes("/own_lines/last_line") && keys.includes("id,buffer,displayed")) {
			this.clientUsesHDataHistory = true;
			log.info(
				`${chalk.yellow(
					"[WeeChat->Node]"
				)} 🔍 Detected weechat-android client (bulk HData request)`
			);
		}

		if (
			path.startsWith("buffer:gui_buffers") &&
			path.includes("/own_lines/last_line") &&
			path.includes("/data")
		) {
			// BULK LINES REQUEST (weechat-android ONLY)
			// Example: "buffer:gui_buffers(*)/own_lines/last_line(-25)/data id,buffer,displayed"
			// Parse line count
			let count = 25;
			const countMatch = path.match(/last_line\((-?\d+)\)/);

			if (countMatch) {
				count = Math.abs(parseInt(countMatch[1], 10));
			}

			log.info(
				`${chalk.cyan(
					"[WeeChat->Node]"
				)} 📦 BULK LINES request: ${count} lines, keys="${keys}"`
			);
			const msg = this.nodeAdapter.buildBulkLinesHData(id, count, keys);
			this.relayClient.send(msg);
		} else if (
			path.startsWith("buffer:gui_buffers") &&
			path.includes("/own_lines/last_read_line")
		) {
			// LAST READ LINES REQUEST (weechat-android ONLY)
			// Example: "buffer:gui_buffers(*)/own_lines/last_read_line/data id,buffer"
			log.info(`${chalk.cyan("[WeeChat->Node]")} 📖 LAST READ LINES request, keys="${keys}"`);
			const msg = this.nodeAdapter.buildLastReadLinesHData(id, keys);
			this.relayClient.send(msg);
		} else if (path.startsWith("buffer:gui_buffers")) {
			// Request all buffers (Lith - list only, no lines)
			const msg = this.nodeAdapter.buildBuffersHData(id);
			this.relayClient.send(msg);
		} else if (path.startsWith("hotlist:gui_hotlist")) {
			// Request hotlist (unread/highlight tracking)
			const msg = this.buildHotlistHData(id);
			this.relayClient.send(msg);
		} else if (path.includes("/own_lines/last_line") && path.match(/buffer:0x[0-9a-f]+/i)) {
			// PER-BUFFER LINES REQUEST (weechat-android ONLY)
			// Example: "buffer:0x12345/own_lines/last_line(-100)/data id,date,displayed,prefix,message,highlight,notify,tags_array"
			const match = path.match(/buffer:0x([0-9a-f]+)/i);

			if (match) {
				const bufferPtr = BigInt("0x" + match[1]);

				// Parse line count
				let count = 100;
				const countMatch = path.match(/last_line\((-?\d+)\)/);

				if (countMatch) {
					count = Math.abs(parseInt(countMatch[1], 10));
				}

				log.info(
					`${chalk.cyan(
						"[WeeChat->Node]"
					)} 📄 PER-BUFFER LINES request: buffer=${bufferPtr}, count=${count}, keys="${keys}"`
				);
				const msg = await this.nodeAdapter.buildPerBufferLinesHData(
					id,
					bufferPtr,
					count,
					keys
				);
				this.relayClient.send(msg);
			} else {
				const msg = new WeeChatMessage(id);
				buildEmptyHData(msg);
				this.relayClient.send(msg);
			}
		} else if (path.includes("/lines/")) {
			// Request message history (Lith ONLY)
			// Parse buffer pointer from path (e.g., "buffer:0x12345/lines/...")
			const match = path.match(/buffer:0x([0-9a-f]+)/i);

			if (match) {
				const bufferPtr = BigInt("0x" + match[1]);

				// Parse line count (e.g., "last_line(-100)")
				let count = 100;
				const countMatch = path.match(/last_line\((-?\d+)\)/);

				if (countMatch) {
					count = Math.abs(parseInt(countMatch[1], 10));
				}

				// CRITICAL FIX: buildLinesHData is now async (loads from DB if needed)
				const msg = await this.nodeAdapter.buildLinesHData(id, bufferPtr, count);
				this.relayClient.send(msg);

				// IMPORTANT: Also send nicklist for this buffer!
				// Lith expects nicklist after opening a buffer (like Vue does)
				log.info(
					`${chalk.cyan(
						"[WeeChat->Node]"
					)} Sending nicklist for buffer ${bufferPtr} (after fetchLines)`
				);
				this.sendNicklistForBuffer(bufferPtr);
			} else {
				// Invalid buffer pointer
				const msg = new WeeChatMessage(id);
				buildEmptyHData(msg);
				this.relayClient.send(msg);
			}
		} else {
			// Unknown hdata request
			log.warn(`${chalk.yellow("[WeeChat->Node]")} Unknown hdata request: ${path}`);
			const msg = new WeeChatMessage(id);
			buildEmptyHData(msg);
			this.relayClient.send(msg);
		}
	}

	/**
	 * Handle nicklist command
	 * If args is empty, send nicklist for ALL buffers
	 * If args has buffer pointer, send nicklist for that buffer only
	 */
	private handleNicklist(id: string, args: string): void {
		log.info(`${chalk.cyan("[WeeChat->Node]")} Nicklist request: "${args}"`);

		// Parse buffer pointer (if provided)
		const match = args.match(/0x([0-9a-f]+)/i);

		if (!match) {
			// No buffer specified - send nicklist for ALL buffers
			log.info(`${chalk.cyan("[WeeChat->Node]")} Sending nicklist for ALL buffers`);
			this.sendNicklistForAllBuffers(id);
			return;
		}

		// Send nicklist for specific buffer
		const bufferPtr = BigInt("0x" + match[1]);
		const buffer = this.nodeAdapter.getBufferByPointer(bufferPtr);

		if (!buffer) {
			log.warn(`${chalk.yellow("[WeeChat->Node]")} Buffer not found: ${bufferPtr}`);
			const msg = new WeeChatMessage(id);
			buildEmptyHData(msg);
			this.relayClient.send(msg);
			return;
		}

		// Get network and channel
		const network = this.irssiClient.networks.find((n) => n.uuid === buffer.networkUuid);

		if (!network) {
			const msg = new WeeChatMessage(id);
			buildEmptyHData(msg);
			this.relayClient.send(msg);
			return;
		}

		const channel = network.channels.find((c) => c.id === buffer.channelId);

		if (!channel || buffer.type !== "channel") {
			// No nicklist for non-channel buffers
			const msg = new WeeChatMessage(id);
			buildEmptyHData(msg);
			this.relayClient.send(msg);
			return;
		}

		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Sending nicklist for buffer: ${buffer.fullName} (${
				channel.users.size
			} users)`
		);

		// Build nicklist HData with groups
		const msg = new WeeChatMessage(id);
		this.buildNicklistWithGroups(msg, buffer, channel);
		this.relayClient.send(msg);
	}

	/**
	 * Send nicklist for a specific buffer (called after fetchLines)
	 * This mimics Vue behavior: when opening a channel, send nicklist automatically
	 */
	private sendNicklistForBuffer(bufferPtr: bigint): void {
		const buffer = this.nodeAdapter.getBufferByPointer(bufferPtr);

		if (!buffer || !buffer.channel) {
			log.warn(
				`${chalk.yellow("[WeeChat->Node]")} Buffer not found for nicklist: ${bufferPtr}`
			);
			return;
		}

		const channel = buffer.channel;

		if (buffer.type !== "channel" || channel.users.size === 0) {
			log.debug(
				`${chalk.cyan("[WeeChat->Node]")} No nicklist for buffer ${
					buffer.fullName
				} (not a channel or no users)`
			);
			return;
		}

		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Sending nicklist for ${buffer.fullName} (${
				channel.users.size
			} users)`
		);

		// Send as _nicklist_diff event (not a response to a command)
		const msg = new WeeChatMessage("_nicklist_diff");
		this.buildNicklistWithGroups(msg, buffer, channel);
		this.relayClient.send(msg);
	}

	/**
	 * Send nicklist for ALL buffers (called when Lith sends "nicklist" without args)
	 */
	private sendNicklistForAllBuffers(id: string): void {
		const msg = new WeeChatMessage(id);
		msg.addType(OBJ_HDATA);
		msg.addString("buffer/nicklist_item");
		msg.addString(
			"group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str"
		);

		// Collect all nicklist items from all channels
		const allItems: any[] = [];

		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Scanning ${
				this.irssiClient.networks.length
			} networks for nicklist`
		);

		for (const network of this.irssiClient.networks) {
			log.info(
				`${chalk.cyan("[WeeChat->Node]")} Network ${network.name}: ${
					network.channels.length
				} channels`
			);

			for (const channel of network.channels) {
				log.info(
					`${chalk.cyan("[WeeChat->Node]")} Channel ${channel.name}: type="${
						channel.type
					}", users=${channel.users.size}`
				);

				if (channel.type !== "channel" || channel.users.size === 0) {
					continue;
				}

				const bufferPtr = this.nodeAdapter.getBufferPointer(channel.id);
				const users = Array.from(channel.users.values());

				log.info(
					`${chalk.cyan("[WeeChat->Node]")} Adding ${users.length} users from ${
						network.name
					}/${channel.name}`
				);

				// Categorize users by mode
				const ops: any[] = [];
				const voices: any[] = [];
				const regular: any[] = [];

				for (const user of users) {
					if (user.mode && user.mode.includes("@")) {
						ops.push(user);
					} else if (user.mode && user.mode.includes("+")) {
						voices.push(user);
					} else {
						regular.push(user);
					}
				}

				// Add root group for this buffer
				allItems.push({
					type: "group",
					bufferPtr,
					pointer: stringToPointer(`${bufferPtr}-group-root`),
					group: 1,
					visible: 0,
					level: 0,
					name: "root",
					color: null, // NULL for groups
					prefix: null, // NULL for groups
					prefixColor: null, // NULL for groups
				});

				// Add ops group + ops users
				if (ops.length > 0) {
					allItems.push({
						type: "group",
						bufferPtr,
						pointer: stringToPointer(`${bufferPtr}-group-ops`),
						group: 1,
						visible: 1,
						level: 1,
						name: "000|o",
						color: "weechat.color.nicklist_group",
						prefix: null,
						prefixColor: null,
					});

					for (const user of ops) {
						allItems.push({
							type: "user",
							bufferPtr,
							pointer: stringToPointer(`${bufferPtr}-${user.nick}`),
							group: 0,
							visible: 1,
							level: 0,
							name: user.nick,
							color: "cyan",
							prefix: "@",
							prefixColor: "lightgreen",
						});
					}
				}

				// Add voices group + voice users
				if (voices.length > 0) {
					allItems.push({
						type: "group",
						bufferPtr,
						pointer: stringToPointer(`${bufferPtr}-group-voices`),
						group: 1,
						visible: 1,
						level: 1,
						name: "001|v",
						color: "weechat.color.nicklist_group",
						prefix: null,
						prefixColor: null,
					});

					for (const user of voices) {
						allItems.push({
							type: "user",
							bufferPtr,
							pointer: stringToPointer(`${bufferPtr}-${user.nick}`),
							group: 0,
							visible: 1,
							level: 0,
							name: user.nick,
							color: "yellow",
							prefix: "+",
							prefixColor: "yellow",
						});
					}
				}

				// Add regular users group + regular users
				if (regular.length > 0) {
					allItems.push({
						type: "group",
						bufferPtr,
						pointer: stringToPointer(`${bufferPtr}-group-users`),
						group: 1,
						visible: 1,
						level: 1,
						name: "999|...",
						color: "weechat.color.nicklist_group",
						prefix: null,
						prefixColor: null,
					});

					for (const user of regular) {
						allItems.push({
							type: "user",
							bufferPtr,
							pointer: stringToPointer(`${bufferPtr}-${user.nick}`),
							group: 0,
							visible: 1,
							level: 0,
							name: user.nick,
							color: "default",
							prefix: " ",
							prefixColor: "",
						});
					}
				}
			}
		}

		log.info(`${chalk.cyan("[WeeChat->Node]")} Total nicklist items: ${allItems.length}`);

		// Log first 3 items for debugging
		if (allItems.length > 0) {
			log.info(`${chalk.cyan("[WeeChat->Node]")} First 3 items:`);

			for (let i = 0; i < Math.min(3, allItems.length); i++) {
				const item = allItems[i];
				log.info(
					`${chalk.cyan("[WeeChat->Node]")}   [${i}] type=${item.type}, bufferPtr=${
						item.bufferPtr
					}, pointer=${item.pointer}, group=${item.group}, visible=${
						item.visible
					}, level=${item.level}, name="${item.name}", color=${item.color}, prefix="${
						item.prefix
					}", prefixColor="${item.prefixColor}"`
				);
			}
		}

		msg.addInt(allItems.length);

		for (const item of allItems) {
			msg.addPointer(item.bufferPtr);
			msg.addPointer(item.pointer);
			msg.addChar(item.group);
			msg.addChar(item.visible);
			msg.addInt(item.level);
			msg.addString(item.name);
			msg.addString(item.color);
			msg.addString(item.prefix);
			msg.addString(item.prefixColor);
		}

		const msgData = msg.build();
		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Sending nicklist response: ${
				msgData.length
			} bytes, ${allItems.length} items`
		);
		this.relayClient.send(msg);
	}

	/**
	 * Build nicklist with groups (WeeChat format)
	 *
	 * WeeChat nicklist structure:
	 * - Root group (invisible, level 0)
	 * - Ops group (visible, level 1, name "000|o")
	 * - Voices group (visible, level 1, name "001|v")
	 * - Users group (visible, level 1, name "999|...")
	 * - Users in their respective groups
	 */
	private buildNicklistWithGroups(msg: WeeChatMessage, buffer: any, channel: any): void {
		msg.addType(OBJ_HDATA);

		// h-path: "buffer/nicklist_item"
		msg.addString("buffer/nicklist_item");

		// keys: "group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str"
		msg.addString(
			"group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str"
		);

		// Categorize users by mode
		const users = channel.users || new Map();
		const ops: any[] = [];
		const voices: any[] = [];
		const regular: any[] = [];

		for (const user of users.values()) {
			if (user.mode && user.mode.includes("@")) {
				ops.push(user);
			} else if (user.mode && user.mode.includes("+")) {
				voices.push(user);
			} else {
				regular.push(user);
			}
		}

		// Count total items: root + groups (with users) + users
		let itemCount = 1; // root
		if (ops.length > 0) itemCount += 1 + ops.length; // ops group + ops
		if (voices.length > 0) itemCount += 1 + voices.length; // voices group + voices
		if (regular.length > 0) itemCount += 1 + regular.length; // users group + users

		msg.addInt(itemCount);

		// Generate pointers for groups
		const rootGroupPtr = stringToPointer(`${buffer.pointer}-group-root`);
		const opsGroupPtr = stringToPointer(`${buffer.pointer}-group-ops`);
		const voicesGroupPtr = stringToPointer(`${buffer.pointer}-group-voices`);
		const usersGroupPtr = stringToPointer(`${buffer.pointer}-group-users`);

		// 1. Root group (invisible, level 0)
		msg.addPointer(buffer.pointer); // buffer pointer
		msg.addPointer(rootGroupPtr); // item pointer
		msg.addChar(1); // group
		msg.addChar(0); // invisible
		msg.addInt(0); // level
		msg.addString("root");
		msg.addString(null); // color: NULL for groups
		msg.addString(null); // prefix: NULL for groups
		msg.addString(null); // prefix_color: NULL for groups

		// 2. Ops group + ops users
		if (ops.length > 0) {
			// Ops group
			msg.addPointer(buffer.pointer);
			msg.addPointer(opsGroupPtr);
			msg.addChar(1); // group
			msg.addChar(1); // visible
			msg.addInt(1); // level
			msg.addString("000|o");
			msg.addString("weechat.color.nicklist_group");
			msg.addString(null); // prefix: NULL for groups
			msg.addString(null); // prefix_color: NULL for groups

			// Ops users
			for (const user of ops) {
				const userPtr = stringToPointer(`${buffer.pointer}-${user.nick}`);
				msg.addPointer(buffer.pointer);
				msg.addPointer(userPtr);
				msg.addChar(0); // nick
				msg.addChar(1); // visible
				msg.addInt(0); // level
				msg.addString(user.nick);
				msg.addString("cyan"); // color for ops
				msg.addString("@");
				msg.addString("lightgreen");
			}
		}

		// 3. Voices group + voice users
		if (voices.length > 0) {
			// Voices group
			msg.addPointer(buffer.pointer);
			msg.addPointer(voicesGroupPtr);
			msg.addChar(1); // group
			msg.addChar(1); // visible
			msg.addInt(1); // level
			msg.addString("001|v");
			msg.addString("weechat.color.nicklist_group");
			msg.addString(null); // prefix: NULL for groups
			msg.addString(null); // prefix_color: NULL for groups

			// Voice users
			for (const user of voices) {
				const userPtr = stringToPointer(`${buffer.pointer}-${user.nick}`);
				msg.addPointer(buffer.pointer);
				msg.addPointer(userPtr);
				msg.addChar(0); // nick
				msg.addChar(1); // visible
				msg.addInt(0); // level
				msg.addString(user.nick);
				msg.addString("yellow"); // color for voices
				msg.addString("+");
				msg.addString("yellow");
			}
		}

		// 4. Regular users group + regular users
		if (regular.length > 0) {
			// Users group
			msg.addPointer(buffer.pointer);
			msg.addPointer(usersGroupPtr);
			msg.addChar(1); // group
			msg.addChar(1); // visible
			msg.addInt(1); // level
			msg.addString("999|...");
			msg.addString("weechat.color.nicklist_group");
			msg.addString(null); // prefix: NULL for groups
			msg.addString(null); // prefix_color: NULL for groups

			// Regular users
			for (const user of regular) {
				const userPtr = stringToPointer(`${buffer.pointer}-${user.nick}`);
				msg.addPointer(buffer.pointer);
				msg.addPointer(userPtr);
				msg.addChar(0); // nick
				msg.addChar(1); // visible
				msg.addInt(0); // level
				msg.addString(user.nick);
				msg.addString("default"); // color for regular users
				msg.addString(" ");
				msg.addString("");
			}
		}
	}

	/**
	 * Handle info command
	 */
	private handleInfo(id: string, args: string): void {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} Info request: ${args}`);

		const msg = new WeeChatMessage(id);
		msg.addType(OBJ_INFO);

		// Handle common info requests
		if (args === "version") {
			msg.addInfo("version", "nexuslounge-weechat-bridge 1.0.0");
		} else if (args === "version_number") {
			// WeeChat version number format: 0x04020000 (4.2.0) = 67239936 decimal
			// We emulate WeeChat 4.2.0 for maximum compatibility
			// NOTE: Must be decimal string, not hex! Kotlin's toLong() doesn't support 0x prefix
			msg.addInfo("version_number", "67239936");
		} else {
			msg.addInfo(args, "");
		}

		this.relayClient.send(msg);
	}

	/**
	 * Handle infolist command
	 */
	private handleInfoList(id: string, args: string): void {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} InfoList request: ${args}`);

		// For now, return empty infolist
		const msg = new WeeChatMessage(id);
		buildEmptyHData(msg);
		this.relayClient.send(msg);
	}

	/**
	 * Handle input command (send message or command)
	 * Translates WeeChat commands to Node/IRC commands
	 */
	private handleInput(id: string, args: string): void {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} Input: ${args}`);

		// Parse: "0x12345 /command" or "0x12345 message"
		const spaceIdx = args.indexOf(" ");

		if (spaceIdx < 0) {
			return;
		}

		const bufferPtrStr = args.substring(0, spaceIdx);
		const text = args.substring(spaceIdx + 1);

		// Parse buffer pointer
		const match = bufferPtrStr.match(/0x([0-9a-f]+)/i);

		if (!match) {
			return;
		}

		const bufferPtr = BigInt("0x" + match[1]);
		const buffer = this.nodeAdapter.getBufferByPointer(bufferPtr);

		if (!buffer) {
			log.warn(`${chalk.yellow("[WeeChat->Node]")} Buffer not found: ${bufferPtrStr}`);
			return;
		}

		// Find network and channel
		const network = this.irssiClient.networks.find((n) => n.uuid === buffer.networkUuid);

		if (!network) {
			log.warn(`${chalk.yellow("[WeeChat->Node]")} Network not found: ${buffer.networkUuid}`);
			return;
		}

		const channel = network.channels.find((c) => c.id === buffer.channelId);

		if (!channel) {
			log.warn(`${chalk.yellow("[WeeChat->Node]")} Channel not found: ${buffer.channelId}`);
			return;
		}

		// Translate WeeChat commands to Node actions
		if (text.startsWith("/buffer ")) {
			this.handleBufferCommand(text, network, channel);
			return;
		}

		// Mark channel as read when user sends a message (not a command)
		// This is the same as Vue does - when you type in a channel, it's marked as read
		if (!text.startsWith("/")) {
			log.debug(
				`${chalk.cyan("[WeeChat->Node]")} User sent message in ${
					channel.name
				}, marking as read`
			);
			this.irssiClient.markAsRead(network.uuid, channel.name, false);
		}

		// For IRC commands and messages, send to IrssiClient
		// IrssiClient will handle IRC commands like /msg, /join, /part, etc.
		this.irssiClient.handleInput(this.relayClient.getId(), {
			target: channel.id,
			text: text,
		});
	}

	/**
	 * Handle WeeChat /buffer commands
	 * These are WeeChat-specific and need to be translated to Node actions
	 */
	private handleBufferCommand(text: string, network: any, channel: any): void {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} Buffer command: ${text}`);

		// /buffer set hotlist -1 → mark as read
		if (text.includes("set hotlist -1") || text.includes("set unread")) {
			log.info(
				`${chalk.green("[WeeChat->Node]")} Mark as read: ${network.name}/${channel.name}`
			);
			this.irssiClient.markAsRead(network.uuid, channel.name, false);
			return;
		}

		// /buffer close → close channel (part)
		if (text.includes("close")) {
			log.info(
				`${chalk.green("[WeeChat->Node]")} Close buffer: ${network.name}/${channel.name}`
			);
			// Send /part command to IRC
			this.irssiClient.handleInput(this.relayClient.getId(), {
				target: channel.id,
				text: `/part ${channel.name}`,
			});
			return;
		}

		// Other /buffer commands - ignore or log
		log.warn(`${chalk.yellow("[WeeChat->Node]")} Unsupported /buffer command: ${text}`);
	}

	/**
	 * Handle sync command (subscribe to updates)
	 */
	private async handleSync(id: string, args: string): Promise<void> {
		log.info(`${chalk.cyan("[WeeChat->Node]")} Sync command received: args="${args}"`);

		// If no args, default to "* buffer,nicklist" (sync all buffers)
		if (!args || args.trim().length === 0) {
			args = "* buffer,nicklist";
			log.info(`${chalk.cyan("[WeeChat->Node]")} No args provided, defaulting to: "${args}"`);
		}

		// Parse: "* buffer,nicklist" or "0x12345 buffer"
		const parts = args.split(" ");
		const target = parts[0];
		const flags = parts.length > 1 ? parts[1].split(",") : [];

		if (target === "*") {
			// Sync all buffers
			this.syncAll = true;
			log.info(`${chalk.green("[WeeChat->Node]")} ✅ Syncing ALL buffers (syncAll=true)`);

			// Load message history for all buffers (ONLY for Lith, NOT for weechat-android)
			// Weechat-android gets history through HData requests (last_lines), not through _buffer_line_added events
			if (!this.clientUsesHDataHistory) {
				log.info(
					`${chalk.cyan(
						"[WeeChat->Node]"
					)} Loading message history from encrypted storage (Lith)...`
				);
				await this.nodeAdapter.loadAllMessages();
			} else {
				log.info(
					`${chalk.yellow(
						"[WeeChat->Node]"
					)} Skipping loadAllMessages() for weechat-android (uses HData instead)`
				);
			}
		} else {
			// Sync specific buffer
			const match = target.match(/0x([0-9a-f]+)/i);

			if (match) {
				const bufferPtr = BigInt("0x" + match[1]);
				this.syncedBuffers.add(bufferPtr);
				log.info(`${chalk.green("[WeeChat->Node]")} ✅ Syncing buffer: ${target}`);

				// TODO: Load message history for this specific buffer
				// For now, we only support syncing all buffers at once
			}
		}
	}

	/**
	 * Handle desync command (unsubscribe from updates)
	 */
	private handleDesync(id: string, args: string): void {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} Desync: ${args}`);

		// Parse: "* buffer,nicklist" or "0x12345 buffer"
		const parts = args.split(" ");
		const target = parts[0];

		if (target === "*") {
			// Desync all buffers
			this.syncAll = false;
			this.syncedBuffers.clear();
			log.info(`${chalk.yellow("[WeeChat->Node]")} Desynced all buffers`);
		} else {
			// Desync specific buffer
			const match = target.match(/0x([0-9a-f]+)/i);

			if (match) {
				const bufferPtr = BigInt("0x" + match[1]);
				this.syncedBuffers.delete(bufferPtr);
				log.info(`${chalk.yellow("[WeeChat->Node]")} Desynced buffer: ${target}`);
			}
		}
	}

	/**
	 * Handle test command
	 */
	private handleTest(id: string, args: string): void {
		log.debug(
			`${chalk.cyan(
				"[WeeChat->Node]"
			)} Test command - not needed with real Node (IrssiClient)`
		);
		// We don't need test data, we have real erssi connection
		const msg = new WeeChatMessage(id);
		msg.addType(OBJ_STRING);
		msg.addString("OK");
		this.relayClient.send(msg);
	}

	/**
	 * Send buffer opened event
	 */
	private sendBufferOpened(data: any): void {
		const bufferPtr = data.bufferPtr;
		const channel = data.channel;

		if (!bufferPtr || !channel) {
			log.warn(
				`${chalk.yellow(
					"[WeeChat->Node]"
				)} Invalid buffer_opened data: bufferPtr=${bufferPtr}, channel=${channel}`
			);
			return;
		}

		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Sending buffer opened: ${
				channel.name
			} ptr=0x${bufferPtr.toString(16)}`
		);

		const msg = new WeeChatMessage("_buffer_opened");
		msg.addType(OBJ_HDATA);
		msg.addString("buffer");
		msg.addString(
			"number:int,full_name:str,short_name:str,type:int,nicklist:int,title:str,local_variables:htb,prev_buffer:ptr,next_buffer:ptr"
		);
		msg.addInt(1);

		// p-path: only 1 pointer (buffer pointer)
		// h-path is "buffer" (1 element), so p-path must have 1 pointer!
		msg.addPointer(bufferPtr);

		// Fields: number, full_name, short_name, type, nicklist, title, local_variables, prev_buffer, next_buffer
		msg.addInt(1); // buffer number (not important for Lith)
		msg.addString(`buffer_${data.channelId}`); // full_name
		msg.addString(channel.name); // short_name
		msg.addInt(0); // type (0=formatted, 1=free)
		msg.addInt(channel.type === 1 ? 1 : 0); // nicklist (1=channel, 0=query)
		msg.addString(channel.topic || ""); // title

		// local_variables as hashtable
		msg.addType("htb");
		msg.addHashtable({
			plugin: "irc",
			name: channel.name,
			type: channel.type === 1 ? "channel" : "private",
		});

		msg.addPointer(0n); // prev_buffer
		msg.addPointer(0n); // next_buffer

		this.relayClient.send(msg);
	}

	/**
	 * Send buffer closed event
	 */
	private sendBufferClosed(buffer: any): void {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} Sending buffer closed: ${buffer.fullName}`);

		const msg = new WeeChatMessage("_buffer_closed");
		msg.addType(OBJ_HDATA);
		msg.addString("buffer");
		msg.addString("id:ptr");
		msg.addInt(1);
		msg.addPointer(buffer.pointer);
		msg.addPointer(buffer.pointer);

		this.relayClient.send(msg);
	}

	/**
	 * Get nick color (hash-based, like Vue colorClass)
	 * Returns WeeChat color code (1-32)
	 */
	private getNickColor(nick: string): number {
		let hash = 0;

		for (let i = 0; i < nick.length; i++) {
			hash += nick.charCodeAt(i);
		}

		return 1 + (hash % 32); // color-1 to color-32
	}

	/**
	 * Format string with WeeChat color codes
	 * @param text - text to format
	 * @param color - WeeChat color code (number 0-255 or color name)
	 * @param bold - make text bold
	 * @returns formatted string with WeeChat color codes
	 *
	 * WeeChat color format (from weechatRN parser.js):
	 * - \x19F + 2-digit color = foreground standard color (00-15 = WeeChat named colors)
	 * - \x19F@ + 5-digit color = foreground extended color (00000-00255 = 256 color palette)
	 * - \x1A* = set bold attribute
	 * - \x1C = reset all colors and attributes
	 *
	 * Standard colors (0-15):
	 * 0=default, 1=black, 2=darkgray, 3=red, 4=lightred, 5=green, 6=lightgreen,
	 * 7=brown, 8=yellow, 9=blue, 10=lightblue, 11=magenta, 12=lightmagenta,
	 * 13=cyan, 14=lightcyan, 15=gray, 16=white
	 *
	 * Extended colors (0-255): Full 256 color palette
	 */
	private formatWithColor(text: string, color?: number | string, bold: boolean = false): string {
		if (!text) return "";

		let result = "";

		// Add bold attribute if specified (BEFORE color!)
		if (bold) {
			result += "\x1A*"; // set bold
		}

		// Add color code if specified
		if (color !== undefined) {
			if (typeof color === "number") {
				// WeeChat uses 0-15 for standard colors, 16-255 for extended
				// But we use hash-based colors 1-32, so map to extended palette
				if (color <= 15) {
					// Standard WeeChat color (0-15): \x19F + 2-digit
					result += `\x19F${String(color).padStart(2, "0")}`;
				} else {
					// Extended color (16-255): \x19F@ + 5-digit
					result += `\x19F@${String(color).padStart(5, "0")}`;
				}
			} else {
				// Named color (e.g., "green", "red", "cyan")
				// Map to WeeChat standard colors (0-15)
				const namedColors: Record<string, number> = {
					default: 0,
					black: 1,
					darkgray: 2,
					red: 3,
					lightred: 4,
					green: 5,
					lightgreen: 6,
					brown: 7,
					yellow: 8,
					blue: 9,
					lightblue: 10,
					magenta: 11,
					lightmagenta: 12,
					cyan: 13,
					lightcyan: 14,
					gray: 15,
					white: 16,
				};
				const colorCode = namedColors[color.toLowerCase()] ?? 0; // default to default
				result += `\x19F${String(colorCode).padStart(2, "0")}`;
			}
		}

		result += text;

		// Reset formatting
		result += "\x1C"; // reset all colors and attributes

		return result;
	}

	/**
	 * Send line added event
	 * Format matches official WeeChat Relay protocol (full format)
	 * This provides better compatibility with Lith features like smart filtering
	 */
	private sendLineAdded(buffer: any, message: any): void {
		try {
			log.debug(
				`${chalk.cyan("[WeeChat->Node]")} Sending line added: ${buffer.fullName}, self=${
					message.self
				}, highlight=${message.highlight}`
			);

			const msg = new WeeChatMessage("_buffer_line_added");
			msg.addType(OBJ_HDATA);
			msg.addString("line_data");

			// Format depends on client type:
			// - Weechat-android (clientUsesHDataHistory=true): id,date,displayed,prefix,message,highlight,notify,tags_array
			// - Lith (default): full WeeChat format with all fields
			const isWeechatAndroid = this.clientUsesHDataHistory;

			let header: string;

			if (isWeechatAndroid) {
				// Weechat-android format (from Spec.kt:173-174)
				header =
					"buffer:ptr,id:int,date:tim,displayed:chr,prefix:str,message:str,highlight:chr,notify:int,tags_array:arr";
			} else {
				// Lith format (full WeeChat protocol)
				header =
					"buffer:ptr,id:ptr,date:tim,date_usec:int,date_printed:tim,date_usec_printed:int,displayed:chr,notify_level:int,highlight:chr,tags_array:arr,prefix:str,message:str";
			}

			msg.addString(header);
			msg.addInt(1); // count: 1 line

			// Generate pointers / IDs
			const linePtr = stringToPointer(`${buffer.pointer}-${message.id || Date.now()}`);
			const lineIdPtr = BigInt(message.id || Date.now());
			const lineIdInt = (() => {
				const raw =
					typeof message.id === "string"
						? parseInt(message.id.split("-")[0], 10)
						: Number(Date.now());
				return Number.isFinite(raw)
					? Math.abs(raw % 2147483647)
					: Math.floor(Date.now() % 2147483647);
			})();

			// Calculate timestamps
			const timestampMs = message.time?.getTime() || Date.now();
			const seconds = Math.floor(timestampMs / 1000);
			const microseconds = (timestampMs % 1000) * 1000;

			// Calculate notify level
			let notifyLevel = 1; // default: normal message

			if (message.highlight) {
				notifyLevel = 3; // highlight (mention)
			} else if (
				message.type === "join" ||
				message.type === "part" ||
				message.type === "quit"
			) {
				notifyLevel = 0; // low (join/part/quit - for smart filtering)
			}

			// p-path pointer (1 pointer for line_data)
			msg.addPointer(linePtr);

			// Field 1: buffer:ptr
			msg.addPointer(buffer.pointer);

			// Field 2: id (int for weechat-android, ptr for Lith)
			if (isWeechatAndroid) {
				msg.addInt(lineIdInt);
			} else {
				msg.addPointer(lineIdPtr);
			}

			// Field 3: date:tim
			msg.addTime(seconds);

			if (isWeechatAndroid) {
				// Weechat-android: displayed, prefix, message, highlight, notify, tags_array
				msg.addChar(1); // displayed
			} else {
				// Lith: date_usec, date_printed, date_usec_printed, displayed
				msg.addInt(microseconds); // date_usec
				msg.addTime(seconds); // date_printed
				msg.addInt(microseconds); // date_usec_printed
				msg.addChar(1); // displayed
				msg.addInt(notifyLevel); // notify_level
			}

			// Build prefix and message using nodeAdapter's formatter
			const formatted = this.nodeAdapter.formatMessageForWeechat(message);
			const nick = message.from?.nick || "";

			// Apply color formatting to prefix (for normal messages)
			let prefix = formatted.prefix;
			const messageText = formatted.message;

			// Only apply nick colors for normal messages (not for JOIN/PART/etc)
			if (
				message.type === "message" ||
				message.type === "action" ||
				message.type === "notice"
			) {
				if (nick) {
					const nickColor = this.getNickColor(nick);

					if (message.highlight) {
						prefix = this.formatWithColor(nick, "red", true);
					} else if (message.self) {
						prefix = this.formatWithColor(nick, "cyan", true);
					} else {
						prefix = this.formatWithColor(nick, nickColor, true);
					}
				}
			}

			// Build tags array
			const tags: string[] = [];

			if (message.type === "message") {
				tags.push("irc_privmsg");
				if (!message.self) tags.push("notify_message");
				tags.push("prefix_nick_white");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				if (message.self) tags.push("self_msg");
				tags.push("log1");
			} else if (message.type === "action") {
				tags.push("irc_action");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				tags.push("log1");
			} else if (message.type === "notice") {
				tags.push("irc_notice");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				tags.push("log1");
			} else if (message.type === "join") {
				tags.push("irc_join");
				tags.push("irc_smart_filter");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				tags.push("log4");
			} else if (message.type === "part") {
				tags.push("irc_part");
				tags.push("irc_smart_filter");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				tags.push("log4");
			} else if (message.type === "quit") {
				tags.push("irc_quit");
				tags.push("irc_smart_filter");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				tags.push("log4");
			} else if (message.type === "nick") {
				tags.push("irc_nick");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				tags.push("log1");
			} else if (message.type === "kick") {
				tags.push("irc_kick");
				tags.push("irc_smart_filter");
				if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
				tags.push("log4");
			}

			if (message.highlight) {
				tags.push("notify_highlight");
			}

			// Now send fields in correct order based on client type
			if (isWeechatAndroid) {
				// Weechat-android: buffer,id,date,displayed,prefix,message,highlight,notify,tags_array
				// (buffer, id, date, displayed already sent above)
				msg.addString(prefix); // prefix
				msg.addString(messageText); // message
				msg.addChar(message.highlight ? 1 : 0); // highlight
				msg.addInt(notifyLevel); // notify
				msg.addArray("str", tags); // tags_array
			} else {
				// Lith: buffer,id,date,date_usec,date_printed,date_usec_printed,displayed,notify_level,highlight,tags_array,prefix,message
				// (buffer, id, date, date_usec, date_printed, date_usec_printed, displayed, notify_level already sent above)
				msg.addChar(message.highlight ? 1 : 0); // highlight
				msg.addArray("str", tags); // tags_array
				msg.addString(prefix); // prefix
				msg.addString(messageText); // message
			}

			log.debug(
				`${chalk.cyan(
					"[WeeChat->Node]"
				)} Sending _buffer_line_added: prefix="${prefix}", message="${messageText.substring(
					0,
					50
				)}..."`
			);
			this.relayClient.send(msg);
		} catch (error) {
			log.error(`${chalk.red("[WeeChat->Node]")} Error in sendLineAdded: ${error}`);
		}
	}

	/**
	 * Send nicklist changed event
	 */
	private sendNicklistChanged(buffer: any, users: Map<string, any>): void {
		log.debug(`${chalk.cyan("[WeeChat->Node]")} Sending nicklist changed: ${buffer.fullName}`);

		const msg = new WeeChatMessage("_nicklist_diff");
		msg.addType(OBJ_HDATA);
		msg.addString("nicklist_item");
		msg.addString(
			"buffer:ptr,_diff:chr,group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str"
		);

		const userArray = Array.from(users.values());
		msg.addInt(userArray.length);

		for (const user of userArray) {
			const userPtr = stringToPointer(`${buffer.pointer}-${user.nick}`);
			msg.addPointer(userPtr);
			msg.addPointer(buffer.pointer);
			msg.addChar(43); // '+' = added
			msg.addChar(0); // user
			msg.addChar(1); // visible
			msg.addInt(0); // level
			msg.addString(user.nick);
			msg.addString("default");

			let prefix = "";

			if (user.mode) {
				if (user.mode.includes("o")) prefix = "@";
				else if (user.mode.includes("v")) prefix = "+";
			}

			msg.addString(prefix);
			msg.addString(prefix ? "lightgreen" : "default");
		}

		this.relayClient.send(msg);
	}

	/**
	 * Send nicklist diff event
	 * This is called when nicklist changes (users join/part/mode change)
	 */
	private sendNicklistDiff(data: any): void {
		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Sending nicklist diff for buffer ${data.bufferPtr}`
		);

		// Find buffer
		const buffer = this.nodeAdapter.getBufferByPointer(data.bufferPtr);

		if (!buffer || !buffer.channel) {
			log.warn(`${chalk.yellow("[WeeChat->Node]")} Buffer not found for nicklist diff`);
			return;
		}

		const channel = buffer.channel;
		const users = data.users || Array.from(channel.users.values());

		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Nicklist: ${channel.name} has ${users.length} users`
		);

		if (users.length > 0) {
			log.info(
				`${chalk.cyan("[WeeChat->Node]")} First 3 users: ${users
					.slice(0, 3)
					.map((u: any) => `${u.nick}(${u.mode})`)
					.join(", ")}`
			);
		}

		// Build nicklist_diff message
		// Format: buffer/nicklist_item with _diff:chr for add/remove/update operations
		const msg = new WeeChatMessage("_nicklist_diff");
		msg.addType(OBJ_HDATA);
		msg.addString("buffer/nicklist_item"); // h-path (buffer/nicklist_item)
		msg.addString(
			"_diff:chr,group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str"
		);

		// Send: first remove all old users, then add new ones
		// This ensures Lith clears the nicklist before adding updated users
		// Count: users.length * 2 (remove + add for each user)
		msg.addInt(users.length * 2);

		// First, send remove operations for all users
		for (const user of users) {
			const userPtr = stringToPointer(`${buffer.pointer}-${user.nick}`);

			// p-path: buffer pointer, then item pointer
			msg.addPointer(buffer.pointer); // buffer pointer
			msg.addPointer(userPtr); // item pointer

			msg.addChar(45); // '-' = removed
			msg.addChar(0); // nick (not group)
			msg.addChar(1); // visible
			msg.addInt(0); // level

			msg.addString(user.nick);
			msg.addString("default");
			msg.addString(" "); // prefix
			msg.addString(""); // prefix_color
		}

		// Then, send add operations for all users with updated data
		for (const user of users) {
			const userPtr = stringToPointer(`${buffer.pointer}-${user.nick}`);

			// p-path: buffer pointer, then item pointer
			msg.addPointer(buffer.pointer); // buffer pointer
			msg.addPointer(userPtr); // item pointer

			msg.addChar(43); // '+' = added
			msg.addChar(0); // nick (not group)
			msg.addChar(1); // visible
			msg.addInt(0); // level

			msg.addString(user.nick);
			msg.addString("default");

			// Determine prefix based on mode
			let prefix = " ";
			let prefixColor = "";

			if (user.mode) {
				if (user.mode.includes("@")) {
					prefix = "@";
					prefixColor = "lightgreen";
				} else if (user.mode.includes("+")) {
					prefix = "+";
					prefixColor = "yellow";
				}
			}

			msg.addString(prefix);
			msg.addString(prefixColor);
		}

		this.relayClient.send(msg);
	}

	/**
	 * Send buffer title changed event
	 * This is called when channel topic changes
	 */
	private sendBufferTitleChanged(data: any): void {
		log.debug(
			`${chalk.cyan("[WeeChat->Node]")} Sending buffer title changed for buffer ${
				data.bufferPtr
			}`
		);

		const msg = new WeeChatMessage("_buffer_title_changed");
		msg.addType(OBJ_HDATA);
		msg.addString("buffer");
		msg.addString("title:str");
		msg.addInt(1);

		msg.addPointer(data.bufferPtr);
		msg.addPointer(data.bufferPtr);
		msg.addString(data.topic || "");

		this.relayClient.send(msg);
	}

	/**
	 * Send hotlist changed event
	 * Hotlist shows unread/highlight counters for all buffers
	 */
	private sendHotlistChanged(data: any): void {
		log.info(
			`${chalk.cyan("[WeeChat->Node]")} Sending hotlist update for buffer ${
				data.bufferPtr
			} (unread=${data.unread}, highlight=${data.highlight})`
		);

		// Send _hotlist event with updated hotlist
		// Lith will update unreadMessages and hotMessages from this
		const msg = this.buildHotlistHData("_hotlist");
		this.relayClient.send(msg);
	}

	/**
	 * Build hotlist HData (for hdata hotlist:gui_hotlist(*) command)
	 * This is called when Lith requests the hotlist
	 */
	buildHotlistHData(id: string): WeeChatMessage {
		log.info(`${chalk.cyan("[WeeChat->Node]")} Building hotlist HData (id=${id})`);

		const msg = new WeeChatMessage(id);
		msg.addType(OBJ_HDATA);

		// h-path: "hotlist"
		msg.addString("hotlist");

		// keys: "priority:int,time:tim,time_usec:int,buffer:ptr,count:arr"
		msg.addString("priority:int,time:tim,time_usec:int,buffer:ptr,count:arr");

		// Collect all buffers with unread/highlight from unreadMarkers
		const hotlistItems: any[] = [];

		log.debug(
			`${chalk.cyan("[WeeChat->Node]")} Checking ${
				this.irssiClient.unreadMarkers.size
			} unread markers`
		);

		for (const network of this.irssiClient.networks) {
			for (const channel of network.channels) {
				// Get unread/highlight from unreadMarkers (server-side state)
				const key = this.irssiClient.getMarkerKey(network.uuid, channel.name);
				const marker = this.irssiClient.unreadMarkers.get(key);

				if (marker && marker.unreadCount > 0) {
					const bufferPtr = this.nodeAdapter.getBufferPointer(channel.id);
					const isHighlight = marker.dataLevel === 3; // DataLevel.HILIGHT
					const priority = isHighlight ? 3 : 1; // 3=highlight, 1=message

					log.info(
						`${chalk.green("[WeeChat->Node]")} Hotlist item: ${network.name}/${
							channel.name
						} unread=${
							marker.unreadCount
						} highlight=${isHighlight} priority=${priority}`
					);

					hotlistItems.push({
						pointer: bufferPtr,
						priority,
						time: Math.floor(marker.lastMessageTime / 1000),
						time_usec: (marker.lastMessageTime % 1000) * 1000,
						buffer: bufferPtr,
						count: [
							0, // join/part (not used)
							marker.unreadCount, // unread messages
							0, // private (not used)
							isHighlight ? marker.unreadCount : 0, // highlight
						],
					});
				}
			}
		}

		log.info(`${chalk.cyan("[WeeChat->Node]")} Hotlist has ${hotlistItems.length} items`);

		msg.addInt(hotlistItems.length);

		log.debug(`${chalk.cyan("[WeeChat->Node]")} Hotlist items details:`);

		for (const item of hotlistItems) {
			log.debug(
				`${chalk.cyan("[WeeChat->Node]")}   - ptr=0x${item.pointer.toString(
					16
				)} priority=${item.priority} buffer=0x${item.buffer.toString(
					16
				)} count=[${item.count.join(",")}]`
			);

			// p-path: only 1 pointer (hotlist item pointer)
			// h-path is "hotlist" (1 element), so p-path must have 1 pointer!
			msg.addPointer(item.pointer);

			// Fields: priority, time, time_usec, buffer, count
			msg.addInt(item.priority);
			msg.addTime(item.time);
			msg.addInt(item.time_usec);
			msg.addPointer(item.buffer);

			// count array: [join/part, message, private, highlight]
			msg.addArray("int", item.count);
		}

		return msg;
	}
}
