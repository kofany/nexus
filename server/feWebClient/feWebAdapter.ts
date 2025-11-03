/**
 * fe-web Event Adapter (Server-side)
 *
 * Maps fe-web JSON messages to The Lounge event format.
 * Implements 100% of CLIENT-SPEC.md message types.
 *
 * This is a server-side port of client/js/feWebAdapter.ts
 * Key differences:
 * - No Vue store - uses callback functions instead
 * - No socketWrapper - emits events directly to IrssiClient
 * - Server-side types (Chan, Msg, Network from server/models)
 */

import type {FeWebSocket, FeWebMessage} from "./feWebSocket";
import Chan from "../models/chan";
import Msg from "../models/msg";
import User from "../models/user";
import Prefix from "../models/prefix";
import {ChanType, ChanState} from "../../shared/types/chan";
import {MessageType} from "../../shared/types/msg";
import log from "../log";
import colors from "chalk";

// Callback types for IrssiClient integration
export type NetworkData = {
	uuid: string;
	name: string;
	nick: string;
	serverTag: string;
	channels: Chan[];
	connected: boolean;
	serverOptions: {
		CHANTYPES: string[];
		PREFIX: Prefix;
		NETWORK: string;
	};
};

export type FeWebAdapterCallbacks = {
	onNetworkUpdate: (network: NetworkData) => void;
	onMessage: (networkUuid: string, channelId: number, msg: Msg) => void;
	onChannelJoin: (networkUuid: string, channel: Chan) => Promise<void>;
	onChannelPart: (networkUuid: string, channelId: number) => void;
	onNicklistUpdate: (networkUuid: string, channelId: number, users: User[]) => void;
	onTopicUpdate: (networkUuid: string, channelId: number, topic: string) => void;
	onNickChange: (networkUuid: string, newNick: string) => void;
	onInit: (networks: NetworkData[]) => Promise<void>;
	onMarkRead: (networkUuid: string, channelName: string) => void;
};

export class FeWebAdapter {
	private socket: FeWebSocket;
	private callbacks: FeWebAdapterCallbacks;
	private serverTagToNetworkMap: Map<string, NetworkData> = new Map();
	private messageIdCounter = 1;
	private channelIdCounter = 1;
	private initEmitted = false;
	private networkUuidMap: Map<string, string>; // server_tag -> UUID (persistent)
	private stateDumpReceivedForNetwork: Map<string, number> = new Map(); // serverTag -> timestamp // Track if state_dump was already received for a network

	constructor(
		socket: FeWebSocket,
		callbacks: FeWebAdapterCallbacks,
		existingUuidMap?: Map<string, string>
	) {
		this.socket = socket;
		this.callbacks = callbacks;
		this.networkUuidMap = existingUuidMap || new Map();
		this.registerHandlers();
	}

	/**
	 * Get current network UUID map (for persistence)
	 */
	getNetworkUuidMap(): Map<string, string> {
		return this.networkUuidMap;
	}

	/**
	 * Reset state_dump tracking (call on disconnect to allow fresh state_dump on reconnect)
	 */
	resetStateDumpTracking(): void {
		log.info(`[FeWebAdapter] Resetting state_dump tracking for all networks`);
		this.stateDumpReceivedForNetwork.clear();
		this.initEmitted = false;
	}

	/**
	 * Get next channel ID (for creating channels outside of adapter)
	 */
	getNextChannelId(): number {
		return this.channelIdCounter++;
	}

	/**
	 * Register all message handlers according to CLIENT-SPEC.md
	 */
	private registerHandlers(): void {
		log.info("[FeWebAdapter] Registering fe-web message handlers");

		// 1. auth_ok - Authentication successful
		this.socket.onMessage("auth_ok", (msg) => this.handleAuthOk(msg));

		// 2. message - IRC message (public/private)
		this.socket.onMessage("message", (msg) => this.handleMessage(msg));

		// 3. server_status - Server connection status
		this.socket.onMessage("server_status", (msg) => this.handleServerStatus(msg));

		// 4. channel_join - User joined channel
		this.socket.onMessage("channel_join", (msg) => this.handleChannelJoin(msg));

		// 5. channel_part - User left channel
		this.socket.onMessage("channel_part", (msg) => this.handleChannelPart(msg));

		// 6. channel_kick - User kicked from channel
		this.socket.onMessage("channel_kick", (msg) => this.handleChannelKick(msg));

		// 7. user_quit - User quit IRC
		this.socket.onMessage("user_quit", (msg) => this.handleUserQuit(msg));

		// 8. topic - Channel topic
		this.socket.onMessage("topic", (msg) => this.handleTopic(msg));

		// 9. channel_mode - Channel mode change
		this.socket.onMessage("channel_mode", (msg) => this.handleChannelMode(msg));

		// 10. nicklist - Complete channel nicklist
		this.socket.onMessage("nicklist", (msg) => this.handleNicklist(msg));

		// 10b. nicklist_update - Delta update for nicklist (NEW!)
		this.socket.onMessage("nicklist_update", (msg) => this.handleNicklistUpdate(msg));

		// 11. nick_change - Nick change
		this.socket.onMessage("nick_change", (msg) => this.handleNickChange(msg));

		// 12. user_mode - User mode change
		this.socket.onMessage("user_mode", (msg) => this.handleUserMode(msg));

		// 13. away - Away status change
		this.socket.onMessage("away", (msg) => this.handleAway(msg));

		// 14. whois - WHOIS response
		this.socket.onMessage("whois", (msg) => this.handleWhois(msg));

		// 15. channel_list - Channel list response
		this.socket.onMessage("channel_list", (msg) => this.handleChannelList(msg));

		// 16. state_dump - Initial state dump
		this.socket.onMessage("state_dump", (msg) => this.handleStateDump(msg));

		// 17. query_opened - Query window opened
		this.socket.onMessage("query_opened", (msg) => this.handleQueryOpened(msg));

		// 18. query_closed - Query window closed (handled by IrssiClient directly via EventEmitter)
		// Register empty handler to suppress warning
		this.socket.onMessage("query_closed", () => {
			// Handled by IrssiClient.handleQueryClosed() via EventEmitter
		});

		// 19. error - Error message
		this.socket.onMessage("error", (msg) => this.handleError(msg));

		// 20. pong - Pong response
		this.socket.onMessage("pong", (msg) => this.handlePong(msg));

		// 21. mark_read - Channel marked as read (from irssi window change)
		this.socket.onMessage("mark_read", (msg) => this.handleMarkRead(msg));

		// 22. activity_update - Activity level changed (handled by IrssiClient directly via EventEmitter)
		// Register empty handler to suppress warning
		this.socket.onMessage("activity_update", () => {
			// Handled by IrssiClient.handleActivityUpdate() via EventEmitter
		});
	}

	/**
	 * 1. auth_ok - Authentication successful
	 */
	private handleAuthOk(msg: FeWebMessage): void {
		log.info("[FeWebAdapter] Authenticated to fe-web");
		// Wait for state_dump to emit init event
	}

	/**
	 * 2. message - IRC message (public/private/action)
	 */
	private handleMessage(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const channelName = msg.channel!;
		let channel = this.findChannel(network, channelName);

		// MSGLEVEL constants from irssi/src/core/levels.h
		const MSGLEVEL_MSGS = 0x0000002; // Private messages (8 decimal)
		const MSGLEVEL_ACTIONS = 0x0000080; // CTCP ACTION (/me) (128 decimal)

		// Create query channel if private message and doesn't exist
		if (!channel && (msg.level === MSGLEVEL_MSGS || msg.level === MSGLEVEL_ACTIONS)) {
			channel = this.createQueryChannel(network, channelName);
		}

		if (!channel) {
			log.warn(`[FeWebAdapter] Channel ${channelName} not found`);
			return;
		}

		// Determine message type based on level
		const messageType =
			msg.level === MSGLEVEL_ACTIONS ? MessageType.ACTION : MessageType.MESSAGE;

		// Convert to The Lounge message format
		const loungeMsg = new Msg({
			type: messageType,
			time: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
			from: new User({nick: msg.nick!}),
			text: msg.text!,
			self: msg.is_own || false,
			highlight: msg.is_highlight || false,
		});
		loungeMsg.id = this.messageIdCounter++;

		// Emit message event
		this.callbacks.onMessage(network.uuid, channel.id, loungeMsg);
	}

	/**
	 * 3. server_status - Server connection status
	 */
	private handleServerStatus(msg: FeWebMessage): void {
		log.info(`[FeWebAdapter] Server status: ${msg.server} = ${msg.text}`);
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		network.connected = msg.text === "connected";
		this.callbacks.onNetworkUpdate(network);
	}

	/**
	 * 4. channel_join - User joined channel
	 */
	private async handleChannelJoin(msg: FeWebMessage): Promise<void> {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const channelName = msg.channel!;
		const nick = msg.nick!;

		let channel = this.findChannel(network, channelName);
		if (!channel) {
			// Create channel - first join (our own)
			// Set network.nick if not already set (from first channel join during state_dump)
			if (!network.nick) {
				network.nick = nick;
				log.info(
					`[FeWebAdapter] Set network nick for ${network.name}: ${nick} (from first channel join)`
				);
			}

			channel = this.createChannel(network, channelName);
			log.info(`[FeWebAdapter] Created channel ${channelName} on ${msg.server}`);
			await this.callbacks.onChannelJoin(network.uuid, channel);
		} else {
			// Someone else joined
			if (nick && nick !== network.nick) {
				this.addUserToChannel(channel, nick);
				const joinMsg = new Msg({
					type: MessageType.JOIN,
					time: new Date(),
					from: new User({nick}),
					hostmask: msg.extra?.hostname || "",
					self: false,
				});
				joinMsg.id = this.messageIdCounter++;
				this.callbacks.onMessage(network.uuid, channel.id, joinMsg);
			}
		}
	}

	/**
	 * 5. channel_part - User left channel
	 */
	private handleChannelPart(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const channel = this.findChannel(network, msg.channel!);
		if (!channel) return;

		const nick = msg.nick!;

		log.debug(
			`[FeWebAdapter] handleChannelPart: nick="${nick}", network.nick="${
				network.nick
			}", match=${nick === network.nick}`
		);

		// Check if it's our own part
		if (nick === network.nick) {
			log.info(
				`[FeWebAdapter] Channel part (OWN): ${channel.name} on ${network.name} - calling onChannelPart callback`
			);
			this.callbacks.onChannelPart(network.uuid, channel.id);
			// Remove channel from network
			network.channels = network.channels.filter((c) => c.id !== channel.id);
		} else {
			// Someone else parted
			log.debug(
				`[FeWebAdapter] Channel part (OTHER): ${nick} from ${channel.name} on ${network.name} - sending part message`
			);
			this.removeUserFromChannel(channel, nick);
			const partMsg = new Msg({
				type: MessageType.PART,
				time: new Date(),
				from: new User({nick}),
				text: msg.text || "", // Part reason
				hostmask: msg.extra?.hostname || "",
				self: false,
			});
			partMsg.id = this.messageIdCounter++;
			this.callbacks.onMessage(network.uuid, channel.id, partMsg);
		}
	}

	/**
	 * 6. channel_kick - User kicked from channel
	 */
	private handleChannelKick(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const channel = this.findChannel(network, msg.channel!);
		if (!channel) return;

		const kickedNick = msg.nick!;
		const kickerNick = msg.extra?.kicker || "Server";

		// Check if we were kicked
		if (kickedNick === network.nick) {
			this.callbacks.onChannelPart(network.uuid, channel.id);
			network.channels = network.channels.filter((c) => c.id !== channel.id);
		} else {
			this.removeUserFromChannel(channel, kickedNick);
		}

		const kickMsg = new Msg({
			type: MessageType.KICK,
			time: new Date(),
			from: new User({nick: kickerNick}),
			target: new User({nick: kickedNick}),
			text: msg.text || "",
			self: false,
		});
		kickMsg.id = this.messageIdCounter++;
		this.callbacks.onMessage(network.uuid, channel.id, kickMsg);
	}

	/**
	 * 7. user_quit - User quit IRC
	 */
	private handleUserQuit(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const nick = msg.nick!;

		// Remove user from all channels
		for (const channel of network.channels) {
			if (this.removeUserFromChannel(channel, nick)) {
				const quitMsg = new Msg({
					type: MessageType.QUIT,
					time: new Date(),
					from: new User({nick}),
					text: msg.text || "", // Quit reason
					hostmask: msg.extra?.hostname || "",
					self: false,
				});
				quitMsg.id = this.messageIdCounter++;
				this.callbacks.onMessage(network.uuid, channel.id, quitMsg);
			}
		}
	}

	/**
	 * 8. topic - Channel topic
	 */
	private handleTopic(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const channel = this.findChannel(network, msg.channel!);
		if (!channel) return;

		channel.topic = msg.text || "";
		this.callbacks.onTopicUpdate(network.uuid, channel.id, channel.topic);

		const topicMsg = new Msg({
			type: MessageType.TOPIC,
			time: new Date(),
			from: new User({nick: msg.nick || ""}),
			text: msg.text || "",
			self: false,
		});
		topicMsg.id = this.messageIdCounter++;
		this.callbacks.onMessage(network.uuid, channel.id, topicMsg);
	}

	/**
	 * 9. channel_mode - Channel mode change
	 * extra.mode: "+o", "-v", etc.
	 * extra.params: ["nick1", "nick2", ...]
	 */
	private handleChannelMode(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const channel = this.findChannel(network, msg.channel!);
		if (!channel) return;

		// Build mode text from extra.mode and extra.params
		// Example: "+o kofany`" or "+v alice bob"
		const mode = msg.extra?.mode || "";
		const params = msg.extra?.params || [];
		const modeText = params.length > 0 ? `${mode} ${params.join(" ")}` : mode;

		const modeMsg = new Msg({
			type: MessageType.MODE_CHANNEL,
			time: new Date(),
			from: new User({nick: msg.nick || ""}),
			text: modeText,
			self: false,
		});
		modeMsg.id = this.messageIdCounter++;
		this.callbacks.onMessage(network.uuid, channel.id, modeMsg);
	}

	/**
	 * 10. nicklist - Complete channel nicklist
	 * text field contains JSON array: [{"nick":"alice","prefix":"@"}, ...]
	 */
	private handleNicklist(msg: FeWebMessage): void {
		log.debug(
			`[FeWebAdapter] handleNicklist: server=${msg.server}, channel=${
				msg.channel
			}, text.length=${msg.text?.length || 0}`
		);

		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) {
			log.error(`[FeWebAdapter] Network not found for server: ${msg.server}`);
			return;
		}

		const channel = this.findChannel(network, msg.channel!);
		if (!channel) {
			log.error(
				`[FeWebAdapter] Channel not found: ${msg.channel} on ${
					msg.server
				}, available: ${network.channels.map((c) => c.name).join(", ")}`
			);
			return;
		}

		try {
			const nicklist: Array<{nick: string; prefix: string}> = JSON.parse(msg.text || "[]");
			log.debug(`[FeWebAdapter] Parsed ${nicklist.length} users from nicklist JSON`);

			// Clear existing users
			channel.users.clear();

			// Add all users with their modes
			nicklist.forEach((userEntry) => {
				// Convert prefix symbol (@, +, %, !) to mode character (o, v, h, Y)
				// using network's PREFIX mapping
				const modeChar = this.prefixToMode(userEntry.prefix, network);

				// User constructor expects modes: string[] (mode characters)
				// and will convert them to symbols using PREFIX.modeToSymbol
				const user = new User(
					{
						nick: userEntry.nick,
						modes: modeChar ? [modeChar] : [], // Array of mode characters
					},
					network.serverOptions.PREFIX // Prefix for symbol conversion
				);

				channel.users.set(user.nick.toLowerCase(), user);
			});

			log.debug(`[FeWebAdapter] Added ${channel.users.size} users to channel.users Map`);

			// Sort users by mode then nick
			this.sortChannelUsers(channel);

			// Emit nicklist update (convert Map to Array)
			const usersArray = Array.from(channel.users.values());
			log.debug(
				`[FeWebAdapter] Calling onNicklistUpdate with ${usersArray.length} users for channel ${channel.id}`
			);
			log.debug(
				`[FeWebAdapter] First 3 users BEFORE callback: ${JSON.stringify(
					usersArray
						.slice(0, 3)
						.map((u) => ({nick: u.nick, modes: u.modes, mode: u.mode}))
				)}`
			);
			this.callbacks.onNicklistUpdate(network.uuid, channel.id, usersArray);
			log.debug(`[FeWebAdapter] onNicklistUpdate callback COMPLETED`);
		} catch (error) {
			log.error(`[FeWebAdapter] Failed to parse nicklist: ${error}`);
		}
	}

	/**
	 * 10b. nicklist_update - Delta update for nicklist
	 * Handles incremental changes: add, remove, mode changes
	 */
	private handleNicklistUpdate(msg: FeWebMessage): void {
		const task = msg.task;

		log.debug(
			`[FeWebAdapter] handleNicklistUpdate: server=${msg.server}, channel=${msg.channel}, nick=${msg.nick}, task=${task}`
		);

		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) {
			log.error(`[FeWebAdapter] Network not found for server: ${msg.server}`);
			return;
		}

		const channel = this.findChannel(network, msg.channel!);
		if (!channel) {
			log.error(`[FeWebAdapter] Channel not found: ${msg.channel} on ${msg.server}`);
			return;
		}

		const nick = msg.nick!;

		if (!task) {
			log.error(`[FeWebAdapter] nicklist_update missing task field`);
			return;
		}

		switch (task) {
			case "add":
				// Add user with no modes
				this.addUserToChannel(channel, nick);
				log.debug(`[FeWebAdapter] Added user ${nick} to ${msg.channel}`);
				break;

			case "remove":
				// Remove user from nicklist
				channel.users.delete(nick.toLowerCase());
				log.debug(`[FeWebAdapter] Removed user ${nick} from ${msg.channel}`);
				break;

			case "change":
				// Nick change - rename user in ALL channels of this network
				const newNick = msg.extra?.new_nick;
				if (!newNick) {
					log.error(`[FeWebAdapter] Nick change missing new_nick in extra`);
					return;
				}

				// Check if it's our own nick and update network.nick
				// Note: irssi may have already updated server->nick to newNick,
				// so check both oldNick and newNick against network.nick
				const isSelf = network.nick === nick || network.nick === newNick;

				log.info(
					`[FeWebAdapter] nicklist_update change: ${nick} → ${newNick} on ${msg.server} (isSelf: ${isSelf}, network.nick: ${network.nick})`
				);

				if (isSelf) {
					network.nick = newNick;
					log.info(
						`[FeWebAdapter] Updated own nick: ${nick} → ${newNick} on ${msg.server}`
					);

					// Emit nick event to update UI
					this.callbacks.onNickChange(network.uuid, newNick);
				}

				// Update nick in ALL channels where this user exists
				let updatedChannels = 0;
				network.channels.forEach((ch) => {
					const user = ch.users.get(nick.toLowerCase());
					if (user) {
						ch.users.delete(nick.toLowerCase());
						user.nick = newNick;
						ch.users.set(newNick.toLowerCase(), user);
						this.sortChannelUsers(ch);
						updatedChannels++;
					}
				});

				log.debug(
					`[FeWebAdapter] Renamed user ${nick} → ${newNick} in ${updatedChannels} channels on ${msg.server}`
				);

				// Emit update for ALL channels (frontend needs to refresh nicklist for all)
				network.channels.forEach((ch) => {
					if (ch.users.has(newNick.toLowerCase())) {
						const usersArray = Array.from(ch.users.values());
						this.callbacks.onNicklistUpdate(network.uuid, ch.id, usersArray);
					}
				});

				// Don't continue to the single-channel update at the end
				return;

			case "+o":
			case "-o":
			case "+v":
			case "-v":
			case "+h":
			case "-h":
				// Mode change
				const targetUser = channel.users.get(nick.toLowerCase());
				if (!targetUser) {
					log.warn(`[FeWebAdapter] User ${nick} not found for mode change ${task}`);
					return;
				}

				const isAdding = task[0] === "+";
				const modeChar = task[1]; // o, v, h

				// Convert mode character to symbol using PREFIX
				const modeSymbol = network.serverOptions.PREFIX.modeToSymbol[modeChar];
				if (!modeSymbol) {
					log.warn(`[FeWebAdapter] Unknown mode character: ${modeChar}`);
					return;
				}

				if (isAdding) {
					// Add mode if not already present
					if (!targetUser.modes.includes(modeSymbol)) {
						targetUser.modes.unshift(modeSymbol); // Add to front (higher priority)
					}
				} else {
					// Remove mode
					targetUser.modes = targetUser.modes.filter((m) => m !== modeSymbol);
				}

				log.debug(
					`[FeWebAdapter] Updated modes for ${nick} in ${
						msg.channel
					}: ${targetUser.modes.join("")}`
				);
				break;

			default:
				log.warn(`[FeWebAdapter] Unknown nicklist_update task: ${task}`);
				return;
		}

		// Re-sort users after any change
		this.sortChannelUsers(channel);

		// Emit update to frontend
		const usersArray = Array.from(channel.users.values());
		this.callbacks.onNicklistUpdate(network.uuid, channel.id, usersArray);
	}

	/**
	 * 11. nick_change - Nick change
	 * nick: old nick, text: new nick
	 */
	private handleNickChange(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const oldNick = msg.nick!;
		const newNick = msg.text!;

		// Check if it's our own nick
		// Note: irssi may have already updated server->nick to newNick before sending this event,
		// so check both oldNick and newNick against network.nick
		const isSelf = network.nick === oldNick || network.nick === newNick;

		log.info(
			`[FeWebAdapter] Nick change: ${oldNick} → ${newNick} on ${msg.server} (isSelf: ${isSelf}, network.nick: ${network.nick})`
		);

		if (isSelf) {
			network.nick = newNick;
			log.info(`[FeWebAdapter] Own nick changed: ${oldNick} → ${newNick} on ${msg.server}`);

			// Emit nick event to update UI (like IRC handler does)
			this.callbacks.onNickChange(network.uuid, newNick);
		}

		// Update nick in all channels
		network.channels.forEach((channel) => {
			const user = channel.users.get(oldNick.toLowerCase());
			if (user) {
				// Remove old entry and add new one
				channel.users.delete(oldNick.toLowerCase());
				user.nick = newNick;
				channel.users.set(newNick.toLowerCase(), user);

				// Sort users alphabetically (important for own nick change!)
				this.sortChannelUsers(channel);

				const nickMsg = new Msg({
					type: MessageType.NICK,
					time: new Date(),
					from: new User({nick: oldNick}),
					new_nick: newNick,
					self: isSelf,
				});
				nickMsg.id = this.messageIdCounter++;
				this.callbacks.onMessage(network.uuid, channel.id, nickMsg);

				// Emit nicklist update for this channel
				const usersArray = Array.from(channel.users.values());
				this.callbacks.onNicklistUpdate(network.uuid, channel.id, usersArray);
			}
		});
	}

	/**
	 * 12. user_mode - User mode change
	 */
	private handleUserMode(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		// User mode changes are shown in lobby
		const lobby = network.channels.find((c) => c.type === "lobby");
		if (!lobby) return;

		const modeMsg = new Msg({
			type: MessageType.MODE,
			time: new Date(),
			from: new User({nick: network.nick}),
			text: msg.text || "",
			self: true,
		});
		modeMsg.id = this.messageIdCounter++;
		this.callbacks.onMessage(network.uuid, lobby.id, modeMsg);
	}

	/**
	 * 13. away - Away status change
	 */
	private handleAway(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const nick = msg.nick!;
		const awayMessage = msg.text || "";

		// Update away status in all channels
		network.channels.forEach((channel) => {
			const user = channel.users.get(nick.toLowerCase());
			if (user) {
				user.away = awayMessage;
			}
		});
	}

	/**
	 * 14. whois - WHOIS response
	 */
	private handleWhois(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		// Show in lobby
		const lobby = network.channels.find((c) => c.type === "lobby");
		if (!lobby) return;

		const whoisMsg = new Msg({
			type: MessageType.WHOIS,
			time: new Date(),
			whois: {
				nick: msg.nick!,
				ident: msg.extra?.user || "",
				hostname: msg.extra?.host || "",
				real_name: msg.extra?.realname || "",
				channels: msg.extra?.channels || "",
				server: msg.extra?.server || "",
				account: msg.extra?.account || "",
			},
			self: false,
		});
		whoisMsg.id = this.messageIdCounter++;
		this.callbacks.onMessage(network.uuid, lobby.id, whoisMsg);
	}

	/**
	 * 15. channel_list - Channel list response
	 */
	private handleChannelList(msg: FeWebMessage): void {
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const channel = this.findChannel(network, msg.channel!);
		if (!channel) return;

		const listMsg = new Msg({
			type: MessageType.MODE_CHANNEL,
			time: new Date(),
			text: `${msg.extra?.list_type || ""} list: ${msg.extra?.entries || ""}`,
			self: false,
		});
		listMsg.id = this.messageIdCounter++;
		this.callbacks.onMessage(network.uuid, channel.id, listMsg);
	}

	/**
	 * 16. state_dump - Initial state dump
	 * Marker message, followed by channel_join, topic, nicklist
	 */
	private async handleStateDump(msg: FeWebMessage): Promise<void> {
		const serverTag = msg.server!;
		log.info(`[FeWebAdapter] State dump started for server: ${serverTag}`);

		const network = this.getOrCreateNetwork(serverTag);
		if (!network) return;

		// Check if this is a duplicate state_dump (within 2 seconds of previous one)
		// This prevents channel duplication when irssi sends state_dump multiple times
		const alreadyReceived = this.stateDumpReceivedForNetwork.get(serverTag);
		const now = Date.now();

		if (alreadyReceived && now - alreadyReceived < 2000) {
			log.warn(
				`[FeWebAdapter] ⚠️ DUPLICATE state_dump for ${serverTag} within 2s - IGNORING to prevent channel duplication`
			);
			return; // Ignore duplicate state_dump
		}

		// Mark as received with timestamp
		this.stateDumpReceivedForNetwork.set(serverTag, now);
		log.info(`[FeWebAdapter] Processing state_dump for ${serverTag} - clearing channels`);

		// Clear existing channels (except lobby) to prepare for fresh state
		const lobby = network.channels.find((ch) => ch.type === "lobby");
		network.channels = lobby ? [lobby] : [];

		// Mark network as connected
		network.connected = true;

		log.info(`[FeWebAdapter] Network ${serverTag} status: connected=${network.connected}`);

		// Emit network status update
		this.callbacks.onNetworkUpdate(network);

		// After state_dump, we'll receive channel_join, topic, nicklist for each channel
		// Emit init after a short delay to ensure all state messages are processed
		setTimeout(() => {
			this.emitInit();
		}, 100);
	}

	/**
	 * Emit init event with all networks
	 */
	private async emitInit(): Promise<void> {
		if (this.initEmitted) return;
		this.initEmitted = true;

		const networks = Array.from(this.serverTagToNetworkMap.values());
		log.info(`[FeWebAdapter] Emitting init event with ${networks.length} networks`);
		await this.callbacks.onInit(networks);
	}

	/**
	 * 17. query_opened - Query window opened
	 */
	private async handleQueryOpened(msg: FeWebMessage): Promise<void> {
		log.info(`[FeWebAdapter] Query opened: ${msg.nick} on ${msg.server}`);
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const nick = msg.nick!;

		// Check if query already exists
		let channel = this.findChannel(network, nick);
		if (channel) {
			log.debug(`[FeWebAdapter] Query ${nick} already exists`);
			return;
		}

		// Create query channel
		channel = this.createQueryChannel(network, nick);
		log.info(`[FeWebAdapter] Created query channel for ${nick} on ${msg.server}`);
		await this.callbacks.onChannelJoin(network.uuid, channel);
	}

	/**
	 * 18. query_closed - Query window closed
	 */
	private handleQueryClosed(msg: FeWebMessage): void {
		log.info(`[FeWebAdapter] Query closed: ${msg.nick} on ${msg.server}`);
		const network = this.getOrCreateNetwork(msg.server!);
		if (!network) return;

		const nick = msg.nick!;

		// Find and remove query channel
		const channelIndex = network.channels.findIndex(
			(ch) => ch.type === "query" && ch.name.toLowerCase() === nick.toLowerCase()
		);

		if (channelIndex === -1) {
			log.debug(`[FeWebAdapter] Query ${nick} not found`);
			return;
		}

		const channel = network.channels[channelIndex];

		// Remove from network
		network.channels.splice(channelIndex, 1);

		// Emit part event
		this.callbacks.onChannelPart(network.uuid, channel.id);
	}

	/**
	 * 19. error - Error message
	 */
	private handleError(msg: FeWebMessage): void {
		log.error(`[FeWebAdapter] Error from fe-web: ${msg.text}`);
	}

	/**
	 * 20. pong - Pong response
	 */
	private handlePong(msg: FeWebMessage): void {
		log.debug("[FeWebAdapter] Received pong");
	}

	/**
	 * 21. mark_read - Channel marked as read (from irssi window change)
	 */
	private handleMarkRead(msg: FeWebMessage): void {
		// Note: fe-web sends server_tag as "server" and target as "channel" in JSON
		const serverTag = msg.server || msg.server_tag;
		const channelName = msg.channel || msg.target;

		if (!serverTag || !channelName) {
			log.warn(`[FeWebAdapter] Invalid mark_read message: ${JSON.stringify(msg)}`);
			return;
		}

		const network = this.serverTagToNetworkMap.get(serverTag);
		if (!network) {
			log.warn(`[FeWebAdapter] Network ${serverTag} not found for mark_read`);
			return;
		}

		const channel = this.findChannel(network, channelName);
		if (!channel) {
			log.warn(
				`[FeWebAdapter] Channel ${channelName} not found for mark_read on ${serverTag}`
			);
			return;
		}

		log.info(
			`[FeWebAdapter] Mark read from irssi: ${serverTag}/${channelName} - syncing to all clients`
		);

		// Forward to IrssiClient (will broadcast to all browsers)
		this.callbacks.onMarkRead(network.uuid, channel.name);
	}

	// Helper methods
	private getOrCreateNetwork(serverTag: string): NetworkData | null {
		let network = this.serverTagToNetworkMap.get(serverTag);

		if (!network) {
			// Create new network with default serverOptions
			// Note: irssi fe-web doesn't send CHANTYPES/PREFIX/NETWORK in state_dump
			// We use defaults + server tag as NETWORK name

			// Create lobby channel (required by The Lounge frontend)
			// Frontend expects network.channels[0] to be lobby, channels[1+] to be real channels
			const lobbyChannel = new Chan({
				name: serverTag,
				type: ChanType.LOBBY,
			});
			lobbyChannel.id = this.channelIdCounter++;
			lobbyChannel.state = ChanState.JOINED; // Lobby is always "joined"

			network = {
				uuid: this.getOrCreateNetworkUuid(serverTag),
				name: serverTag,
				nick: "", // Will be set from state_dump or nick_change
				serverTag: serverTag,
				channels: [lobbyChannel], // Start with lobby channel
				connected: false,
				serverOptions: {
					CHANTYPES: ["#", "&", "!"], // Standard IRC channel types
					PREFIX: new Prefix([
						{symbol: "!", mode: "Y"}, // Owner (rare)
						{symbol: "@", mode: "o"}, // Op
						{symbol: "%", mode: "h"}, // Halfop
						{symbol: "+", mode: "v"}, // Voice
					]),
					NETWORK: serverTag, // Use server tag as network name
				},
			};

			this.serverTagToNetworkMap.set(serverTag, network);
			log.info(
				`[FeWebAdapter] Created network for server tag: ${serverTag} with lobby channel`
			);
			log.debug(
				`[IrssiClient] Network ${serverTag} serverOptions: ${JSON.stringify(
					network.serverOptions
				)}`
			);
		}

		return network;
	}

	private findChannel(network: NetworkData, channelName: string): Chan | null {
		return (
			network.channels.find((c) => c.name.toLowerCase() === channelName.toLowerCase()) || null
		);
	}

	private createChannel(network: NetworkData, channelName: string): Chan {
		const channel = new Chan({
			name: channelName,
			type: channelName.startsWith("#") ? ChanType.CHANNEL : ChanType.QUERY,
			state: ChanState.JOINED, // We only create channels we're joined to
		});
		channel.id = this.channelIdCounter++;
		this.addChannelSorted(network, channel);
		return channel;
	}

	private createQueryChannel(network: NetworkData, nick: string): Chan {
		const channel = new Chan({
			name: nick,
			type: ChanType.QUERY,
			state: ChanState.JOINED, // Query is opened = joined
		});
		channel.id = this.channelIdCounter++;
		this.addChannelSorted(network, channel);
		return channel;
	}

	/**
	 * Add channel to network in sorted order
	 * Sort order: CHANNEL (alphabetically) → QUERY (alphabetically)
	 * Lobby is always first (index 0)
	 */
	private addChannelSorted(network: NetworkData, newChan: Chan): void {
		let index = network.channels.length; // Default to putting as the last item

		// Don't sort special channels in amongst channels/users.
		if (newChan.type === ChanType.CHANNEL || newChan.type === ChanType.QUERY) {
			// We start at 1 so we don't test against the lobby
			// Sort order: CHANNEL (alphabetically) → QUERY (alphabetically)
			for (let i = 1; i < network.channels.length; i++) {
				const compareChan = network.channels[i];

				// Skip non-channel/query types (special channels)
				if (compareChan.type !== ChanType.CHANNEL && compareChan.type !== ChanType.QUERY) {
					index = i;
					break;
				}

				// If new channel is CHANNEL and compare is QUERY, insert before (channels come first)
				if (newChan.type === ChanType.CHANNEL && compareChan.type === ChanType.QUERY) {
					index = i;
					break;
				}

				// If new channel is QUERY and compare is CHANNEL, continue (queries come after channels)
				if (newChan.type === ChanType.QUERY && compareChan.type === ChanType.CHANNEL) {
					continue;
				}

				// Both are same type (both CHANNEL or both QUERY) - sort alphabetically
				if (
					newChan.name.localeCompare(compareChan.name, undefined, {
						sensitivity: "base",
					}) <= 0
				) {
					index = i;
					break;
				}
			}
		}

		network.channels.splice(index, 0, newChan);
	}

	private addUserToChannel(channel: Chan, nick: string): void {
		// Check if user already exists
		const existingUser = channel.users.get(nick.toLowerCase());
		if (!existingUser) {
			const user = new User({nick});
			channel.users.set(nick.toLowerCase(), user);
		}
	}

	private removeUserFromChannel(channel: Chan, nick: string): boolean {
		return channel.users.delete(nick.toLowerCase());
	}

	/**
	 * Get or create persistent UUID for network (based on server tag)
	 * This ensures the same server always gets the same UUID, even after reconnect
	 */
	private getOrCreateNetworkUuid(serverTag: string): string {
		let uuid = this.networkUuidMap.get(serverTag);
		if (!uuid) {
			uuid = `network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			this.networkUuidMap.set(serverTag, uuid);
			log.info(`[FeWebAdapter] Created new persistent UUID for server ${serverTag}: ${uuid}`);
		} else {
			log.info(`[FeWebAdapter] Using existing UUID for server ${serverTag}: ${uuid}`);
		}
		return uuid;
	}

	private generateUuid(): string {
		return `network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Convert IRC prefix symbol to mode character
	 * Uses the same mapping as network.serverOptions.PREFIX
	 *
	 * @param prefix - Symbol from fe-web nicklist (@, +, %, !, etc.)
	 * @param network - Network to get PREFIX mapping from
	 * @returns Mode character (o, v, h, Y, etc.) or empty string
	 */
	private prefixToMode(prefix: string, network: NetworkData): string {
		if (!prefix) return "";

		// Find mode character for this symbol in PREFIX mapping
		for (const p of network.serverOptions.PREFIX.prefix) {
			if (p.symbol === prefix) {
				return p.mode;
			}
		}

		return "";
	}

	/**
	 * Sort channel users by mode then nick
	 * Order: owner (~), admin (&), op (@), halfop (%), voice (+), normal
	 */
	private sortChannelUsers(channel: Chan): void {
		const modeOrder = ["q", "a", "o", "h", "v", ""];

		// Convert Map to Array, sort, then recreate Map
		const usersArray = Array.from(channel.users.values());
		usersArray.sort((a, b) => {
			const aModeIndex = modeOrder.indexOf(a.mode);
			const bModeIndex = modeOrder.indexOf(b.mode);

			if (aModeIndex !== bModeIndex) {
				return aModeIndex - bModeIndex;
			}

			// Same mode - sort by nick (case insensitive)
			return a.nick.toLowerCase().localeCompare(b.nick.toLowerCase());
		});

		// Recreate Map with sorted users
		channel.users.clear();
		usersArray.forEach((user) => {
			channel.users.set(user.nick.toLowerCase(), user);
		});
	}
}
