/**
 * irssi Client - Modified Client class for irssi proxy mode
 *
 * This replaces the traditional IRC client with a persistent WebSocket connection to irssi fe-web.
 * Key differences from original Client:
 * - No Network[] management (irssi handles IRC connections)
 * - Persistent WebSocket connection to irssi (always active)
 * - Encryption key stored in memory (for message encryption)
 * - Multiple browser sessions per user (attachedBrowsers)
 * - Encrypted message storage (EncryptedMessageStorage)
 */

import _ from "lodash";
import {v4 as uuidv4} from "uuid";
import crypto from "crypto";
import colors from "chalk";
import type {Socket} from "socket.io";

import log from "./log";
import Chan from "./models/chan";
import Msg from "./models/msg";
import User from "./models/user";
import Network from "./models/network";
import Config from "./config";
import {SharedMention} from "../shared/types/mention";
import ClientManager from "./clientManager";
import {EncryptedMessageStorage} from "./plugins/messageStorage/encrypted";
import {ServerToClientEvents} from "../shared/types/socket-events";
import {FeWebSocket, FeWebConfig, FeWebMessage} from "./feWebClient/feWebSocket";
import {FeWebEncryption} from "./feWebClient/feWebEncryption";
import {FeWebAdapter, FeWebAdapterCallbacks, NetworkData} from "./feWebClient/feWebAdapter";
import {
	IrssiNetwork,
	IrssiServer,
	CommandResult,
	NetworkFormData,
	ServerFormData,
	networkFormToIrssi,
	serverFormToIrssi,
	snakeToCamel,
} from "./types/irssi-network";
import UAParser from "ua-parser-js";

// irssi connection config (stored in user.json)
export type IrssiConnectionConfig = {
	host: string;
	port: number;
	passwordEncrypted: string; // Encrypted with encryption key
	encryption: boolean;
	useTLS: boolean; // Use wss:// (required for fe-web v1.5)
	rejectUnauthorized: boolean; // Accept self-signed certificates
};

// WeeChat Relay config (per-user, stored in user.json)
export type WeeChatRelayConfig = {
	enabled: boolean;
	port: number; // Unique port for this user
	passwordEncrypted: string; // Encrypted with encryption key (like irssiConnection)
	compression: boolean;
};

// User config for irssi proxy mode
export type IrssiUserConfig = {
	log: boolean;
	password: string; // bcrypt hash (for authentication)
	irssiConnection: IrssiConnectionConfig;
	weechatRelay?: WeeChatRelayConfig; // Optional WeeChat Relay configuration
	sessions: {
		[token: string]: {
			lastUse: number;
			ip: string;
			agent: string;
		};
	};
	clientSettings: {
		[key: string]: any;
	};
	browser?: {
		language?: string;
		ip?: string;
		hostname?: string;
		isSecure?: boolean;
	};
	networkUuidMap?: {
		[serverTag: string]: string; // server_tag -> persistent UUID
	};
};

// Browser session info
type BrowserSession = {
	socket: Socket;
	openChannel: number;
};

// Unread marker (activity tracking)
export enum DataLevel {
	NONE = 0, // No activity (read)
	TEXT = 1, // Normal text (gray)
	MSG = 2, // Message or highlight word (blue)
	HILIGHT = 3, // Nick mention (red)
}

export interface UnreadMarker {
	network: string; // Network UUID
	channel: string; // Channel name (lowercase)
	unreadCount: number; // Number of unread messages
	lastReadTime: number; // Unix timestamp of last read
	lastMessageTime: number; // Unix timestamp of last message
	dataLevel: DataLevel; // Activity level (from irssi)
}

export class IrssiClient {
	// Basic properties
	id: string;
	name: string;
	manager: ClientManager;
	config: IrssiUserConfig;

	// irssi connection (persistent!)
	irssiConnection: FeWebSocket | null = null;
	feWebAdapter: FeWebAdapter | null = null;
	encryptionKey: Buffer | null = null;
	irssiPassword: string | null = null; // Decrypted irssi password (in memory)
	userPassword: string | null = null; // User's The Lounge password (in memory, for encryption)

	// Networks from irssi (managed by FeWebAdapter)
	networks: NetworkData[] = [];

	// Browser sessions (multiple browsers per user)
	attachedBrowsers: Map<string, BrowserSession> = new Map();

	// WeeChat Relay server (for Lith clients) - per user!
	weechatRelayServer: any = null; // WeeChatRelayServer instance
	weechatRelayPassword: string | null = null; // Decrypted WeeChat password (in memory)
	weechatErssiAdapter: any = null; // ErssiToWeeChatAdapter instance (shared by all Lith clients)

	// Message storage (encrypted)
	messageStorage: EncryptedMessageStorage | null = null;

	// Unread markers (activity tracking) - in-memory only!
	private unreadMarkers: Map<string, UnreadMarker> = new Map();

	// Active window in irssi (network:channel) - for proper activity tracking
	// When user switches windows in irssi, this gets updated
	// This prevents activity_update being sent/processed for active window
	private activeWindowInIrssi: string | null = null; // Format: "network_uuid:channel_name"

	// Network/Server management - pending requests
	private pendingRequests: Map<
		string,
		{
			resolve: (result: CommandResult) => void;
			reject: (error: Error) => void;
			timeout: NodeJS.Timeout;
		}
	> = new Map();

	private pendingListRequests: Map<
		string,
		{
			resolve: (result: any) => void;
			reject: (error: Error) => void;
			timeout: NodeJS.Timeout;
		}
	> = new Map();

	// State
	awayMessage: string = "";
	lastActiveChannel: number = -1;
	mentions: SharedMention[] = [];
	fileHash: string = "";

	// ID generators
	idMsg: number = 1;
	idChan: number = 1;

	constructor(manager: ClientManager, name: string, config: IrssiUserConfig) {
		this.id = uuidv4();
		this.name = name;
		this.manager = manager;
		this.config = config;

		// Ensure config has required fields
		this.config.log = Boolean(this.config.log);
		this.config.password = String(this.config.password);

		if (!_.isPlainObject(this.config.sessions)) {
			this.config.sessions = {};
		}

		if (!_.isPlainObject(this.config.clientSettings)) {
			this.config.clientSettings = {};
		}

		if (!_.isPlainObject(this.config.browser)) {
			this.config.browser = {};
		}

		if (this.config.clientSettings.awayMessage) {
			this.awayMessage = this.config.clientSettings.awayMessage;
		}

		log.info(`irssi client created for user ${colors.bold(this.name)}`);
	}

	/**
	 * Login user - derive encryption key and connect to irssi
	 *
	 * Encryption architecture:
	 * - WebSocket auth + encryption uses irssi password
	 * - Message storage encryption uses derived key
	 */
	async login(userPassword: string): Promise<void> {
		log.info(`User ${colors.bold(this.name)} logging in...`);

		// Store user password in memory (for message storage encryption)
		this.userPassword = userPassword;

		// Check if irssi password is configured
		if (!this.config.irssiConnection.passwordEncrypted) {
			log.warn(
				`User ${colors.bold(
					this.name
				)} has no irssi password configured - skipping connection`
			);
			// Don't throw error - user can configure it later in Settings
			return;
		}

		// Step 1: Decrypt irssi password using IP+PORT salt
		// Import decryptIrssiPassword from irssiConfigHelper
		const {decryptIrssiPassword} = await import("./irssiConfigHelper");

		this.irssiPassword = await decryptIrssiPassword(
			this.config.irssiConnection.passwordEncrypted,
			this.config.irssiConnection.host,
			this.config.irssiConnection.port
		);

		log.info(`irssi password decrypted for user ${colors.bold(this.name)}`);

		// Step 2: Derive message storage encryption key
		if (!this.encryptionKey) {
			this.encryptionKey = crypto.pbkdf2Sync(
				this.irssiPassword,
				"irssi-message-storage-v1",
				10000,
				32,
				"sha256"
			);
			log.info(`Message storage encryption key derived for user ${colors.bold(this.name)}`);
		} else {
			log.info(`Message storage encryption key already exists (from autoconnect)`);
		}

		// Step 3: Initialize encrypted message storage (if not already enabled by autoconnect)
		if (this.config.log && !Config.values.public && !this.messageStorage) {
			this.messageStorage = new EncryptedMessageStorage(this.name, this.encryptionKey);
			await this.messageStorage.enable();
			log.info(`Encrypted message storage enabled for user ${colors.bold(this.name)}`);
		} else if (this.messageStorage) {
			log.info(`Message storage already enabled (from autoconnect)`);
		}

		// Step 4: Connect to irssi fe-web (ASYNCHRONOUSLY - don't block login!)
		// Don't await - let it connect in background
		// If it fails, user can still use The Lounge UI and fix config in Settings
		this.connectToIrssi().catch((error) => {
			log.error(`Failed to connect to irssi for user ${colors.bold(this.name)}: ${error}`);
			// Don't throw - user is already logged in to The Lounge
		});

		// Step 5: Start WeeChat Relay server (if enabled)
		if (this.config.weechatRelay?.enabled) {
			this.startWeeChatRelay().catch((error) => {
				log.error(`Failed to start WeeChat Relay for user ${colors.bold(this.name)}: ${error}`);
			});
		}

		log.info(`User ${colors.bold(this.name)} logged in successfully`);
	}

	/**
	 * Auto-connect to irssi at startup (without user password)
	 * Uses IP+PORT encryption to decrypt irssi password
	 * Message storage is enabled using irssiPassword (no userPassword needed!)
	 */
	async autoConnectToIrssi(): Promise<void> {
		log.info(`User ${colors.bold(this.name)} auto-connecting to irssi...`);

		// Check if irssi password is configured
		if (!this.config.irssiConnection.passwordEncrypted) {
			log.warn(
				`User ${colors.bold(
					this.name
				)} has no irssi password configured - skipping autoconnect`
			);
			return;
		}

		// Decrypt irssi password using IP+PORT salt
		const {decryptIrssiPassword} = await import("./irssiConfigHelper");

		this.irssiPassword = await decryptIrssiPassword(
			this.config.irssiConnection.passwordEncrypted,
			this.config.irssiConnection.host,
			this.config.irssiConnection.port
		);

		log.info(`irssi password decrypted for user ${colors.bold(this.name)}`);

		// Derive message storage encryption key from irssiPassword
		// Use fixed salt since we don't have userPassword during autoconnect
		this.encryptionKey = crypto.pbkdf2Sync(
			this.irssiPassword,
			"irssi-message-storage-v1", // Fixed salt
			10000,
			32,
			"sha256"
		);

		log.info(`Message storage encryption key derived for user ${colors.bold(this.name)}`);

		// Initialize encrypted message storage
		if (this.config.log && !Config.values.public) {
			this.messageStorage = new EncryptedMessageStorage(this.name, this.encryptionKey);
			await this.messageStorage.enable();
			log.info(`Encrypted message storage enabled for user ${colors.bold(this.name)}`);
		}

		// Connect to irssi (with message storage enabled!)
		await this.connectToIrssiInternal();
	}

	/**
	 * Connect to irssi fe-web (persistent connection with encryption)
	 */
	async connectToIrssi(): Promise<void> {
		if (this.irssiConnection) {
			log.warn(`User ${colors.bold(this.name)} already connected to irssi`);
			return;
		}

		if (!this.irssiPassword || !this.encryptionKey) {
			throw new Error("Cannot connect to irssi: encryption key not derived");
		}

		await this.connectToIrssiInternal();
	}

	/**
	 * Internal method to connect to irssi WebSocket
	 */
	private async connectToIrssiInternal(): Promise<void> {
		if (this.irssiConnection) {
			log.warn(`User ${colors.bold(this.name)} already connected to irssi`);
			return;
		}

		if (!this.irssiPassword) {
			throw new Error("Cannot connect to irssi: irssi password not decrypted");
		}

		const feWebConfig: FeWebConfig = {
			host: this.config.irssiConnection.host,
			port: this.config.irssiConnection.port,
			password: this.irssiPassword,
			encryption: true, // ALWAYS true for fe-web v1.5

			// SSL/TLS options (fe-web v1.5 REQUIRES wss://)
			useTLS: true, // ALWAYS true for fe-web v1.5
			rejectUnauthorized: false, // Accept self-signed certificates

			reconnect: true,
			reconnectDelay: 1000,
			maxReconnectDelay: 30000,

			// Note: disconnect is handled via EventEmitter in setupIrssiEventHandlers()
		};

		this.irssiConnection = new FeWebSocket(feWebConfig);

		// Initialize FeWebAdapter with callbacks
		const adapterCallbacks: FeWebAdapterCallbacks = {
			onNetworkUpdate: (network) => this.handleNetworkUpdate(network),
			onMessage: (networkUuid, channelId, msg) =>
				this.handleMessage(networkUuid, channelId, msg),
			onChannelJoin: (networkUuid, channel) => this.handleChannelJoin(networkUuid, channel),
			onChannelPart: (networkUuid, channelId) =>
				this.handleChannelPart(networkUuid, channelId),
			onNicklistUpdate: (networkUuid, channelId, users) =>
				this.handleNicklistUpdate(networkUuid, channelId, users),
			onTopicUpdate: (networkUuid, channelId, topic) =>
				this.handleTopicUpdate(networkUuid, channelId, topic),
			onNickChange: (networkUuid, newNick) => this.handleNickChange(networkUuid, newNick),
			onInit: (networks) => this.handleInit(networks),
			onMarkRead: (networkUuid, channelName) =>
				this.handleMarkReadFromIrssi(networkUuid, channelName),
		};

		// Load existing network UUID map from config (for persistent UUIDs across reconnects)
		const existingUuidMap = new Map<string, string>();
		if (this.config.networkUuidMap) {
			for (const [serverTag, uuid] of Object.entries(this.config.networkUuidMap)) {
				existingUuidMap.set(serverTag, uuid);
			}
			log.info(
				`[IrssiClient] Loaded ${existingUuidMap.size} persistent network UUIDs from config`
			);
		}

		this.feWebAdapter = new FeWebAdapter(
			this.irssiConnection,
			adapterCallbacks,
			existingUuidMap
		);

		// Set up event handlers
		this.setupIrssiEventHandlers();

		// Connect
		await this.irssiConnection.connect();

		log.info(
			`User ${colors.bold(this.name)} connected to irssi at wss://${feWebConfig.host}:${
				feWebConfig.port
			} (dual-layer security)`
		);
	}

	/**
	 * Set up event handlers for irssi WebSocket
	 * Note: Most events are handled by FeWebAdapter, these are just for logging
	 */
	private setupIrssiEventHandlers(): void {
		if (!this.irssiConnection) {
			return;
		}

		// Connection events
		(this.irssiConnection as any).on("connected", () => {
			log.info(`User ${colors.bold(this.name)}: irssi WebSocket connected`);
		});

		// DISCONNECT HANDLER - czyści sieci i broadcast do przeglądarek
		(this.irssiConnection as any).on("disconnected", (code: number, reason: string) => {
			log.warn(
				`User ${colors.bold(this.name)}: irssi WebSocket disconnected (code: ${code})`
			);

			log.info(`[DISCONNECT] ===============================================`);
			log.info(`[DISCONNECT] BEFORE: this.networks.length = ${this.networks.length}`);

			// CLEAR networks on disconnect
			const clearedCount = this.networks.length;
			this.networks = [];
			this.lastActiveChannel = -1;

			// Reset state_dump tracking in FeWebAdapter (allow fresh state_dump on reconnect)
			if (this.feWebAdapter) {
				this.feWebAdapter.resetStateDumpTracking();
			}

			log.info(`[DISCONNECT] AFTER: this.networks.length = ${this.networks.length}`);
			log.info(`[DISCONNECT] Broadcasting to ${this.attachedBrowsers.size} browsers`);

			// Broadcast disconnect status to all browsers
			log.info(`[DISCONNECT] 1. Sending irssi:status {connected: false}`);
			this.broadcastToAllBrowsers("irssi:status" as any, {
				connected: false,
				error: `Lost connection to irssi WebSocket (code: ${code})`,
			});

			// Also send empty init to clear UI networks
			log.info(`[DISCONNECT] 2. Sending init {networks: []}`);
			this.broadcastToAllBrowsers("init", {
				networks: [],
				active: -1,
			});

			log.info(
				`User ${colors.bold(
					this.name
				)}: cleared ${clearedCount} networks after irssi disconnect`
			);
		});

		this.irssiConnection.on("error", (msg: FeWebMessage) => {
			log.error(`User ${colors.bold(this.name)}: irssi WebSocket error: ${msg.text}`);
		});

		this.irssiConnection.on("auth_ok", () => {
			log.info(`User ${colors.bold(this.name)}: irssi authentication successful`);
		});

		(this.irssiConnection as any).on("auth_fail", () => {
			log.error(`User ${colors.bold(this.name)}: irssi authentication failed`);
		});

		// Network/Server management handlers
		this.irssiConnection.onMessage("command_result", (msg) => this.handleCommandResult(msg));
		this.irssiConnection.onMessage("network_list_response", (msg) =>
			this.handleNetworkListResponse(msg)
		);
		this.irssiConnection.onMessage("server_list_response", (msg) =>
			this.handleServerListResponse(msg)
		);

		// Activity tracking (unread markers)
		(this.irssiConnection as any).on("activity_update", (msg: FeWebMessage) => {
			this.handleActivityUpdate(msg);
		});

		// Query closed in irssi (2-way sync)
		(this.irssiConnection as any).on("query_closed", (msg: FeWebMessage) => {
			this.handleQueryClosed(msg);
		});
	}

	/**
	 * Handle NAMES request from browser (refresh nicklist)
	 */
	async handleNamesRequest(socketId: string, data: {target: number}): Promise<void> {
		if (!this.irssiConnection) {
			log.error(
				`User ${colors.bold(this.name)}: cannot request names, not connected to irssi`
			);
			return;
		}

		// Find channel in ALL networks
		let channel: Chan | undefined;
		let network: NetworkData | undefined;

		for (const net of this.networks) {
			channel = net.channels.find((c) => c.id === data.target);
			if (channel) {
				network = net;
				break;
			}
		}

		if (!channel || !network) {
			log.warn(
				`User ${colors.bold(this.name)}: channel ${data.target} not found for NAMES request`
			);
			return;
		}

		// Execute /NAMES command in irssi to refresh internal state
		const command = `names ${channel.name}`;
		await this.irssiConnection.executeCommand(command, network.serverTag);

		log.info(
			`User ${colors.bold(this.name)}: requested NAMES for ${channel.name} on ${
				network.serverTag
			}`
		);

		// fe-web will send nicklist message after executing NAMES
		// We don't need to do anything else here - the nicklist handler will take care of it
	}

	/**
	 * Send /window 1 to irssi to switch to lobby window
	 * This prevents irssi from staying on active channel and marking everything as read
	 * Only sends if at least one browser is connected (prevents interfering with terminal usage)
	 */
	private sendWindowCommand(serverTag?: string): void {
		// Only send if at least one browser is connected
		if (this.attachedBrowsers.size === 0) {
			log.debug(`[IrssiClient] Skipping /window 1 - no browsers connected (terminal usage)`);
			return;
		}

		if (!this.irssiConnection) {
			return;
		}

		// Send /window 1 to switch to lobby (window 1 is always the first window)
		this.irssiConnection.executeCommand("window 1", serverTag);
		log.debug(
			`[IrssiClient] Sent /window 1 to irssi (browsers connected: ${this.attachedBrowsers.size})`
		);
	}

	/**
	 * Handle input from browser (user command/message)
	 * Includes command translation layer for Vue-specific commands
	 */
	async handleInput(socketId: string, data: {target: number; text: string}): Promise<void> {
		log.info(
			`[DEBUG handleInput] socketId=${socketId}, target=${data.target}, text="${data.text}"`
		);

		if (!this.irssiConnection) {
			log.error(`User ${colors.bold(this.name)}: cannot send input, not connected to irssi`);
			return;
		}

		const text = data.text;

		// Split multi-line input
		const lines = text.split("\n");
		for (const line of lines) {
			if (!line.trim()) continue;

			// Check if it's a command (starts with /)
			if (line.charAt(0) === "/" && line.charAt(1) !== "/") {
				// Find channel and network for this target
				let channel: Chan | undefined;
				let network: NetworkData | undefined;

				for (const net of this.networks) {
					channel = net.channels.find((c) => c.id === data.target);
					if (channel) {
						network = net;
						break;
					}
				}

				if (!channel || !network) {
					log.warn(
						`User ${colors.bold(this.name)}: channel ${
							data.target
						} not found for command`
					);
					return;
				}

				// Parse command and args
				const parts = line.substring(1).split(" ");
				const commandName = parts[0].toLowerCase();
				const args = parts.slice(1);

				// Command translation layer
				const translated = await this.translateCommand(commandName, args, channel, network);

				if (translated === false) {
					// Command was handled by translator, don't forward to irssi
					continue;
				}

				// Use translated command if available, otherwise use original
				const finalCommand = translated || line.substring(1);

				await this.irssiConnection.executeCommand(finalCommand, network.serverTag);
				log.debug(
					`User ${colors.bold(this.name)}: sent command: /${finalCommand} on ${
						network.serverTag
					}`
				);

				// Send /window 1 after window-management commands to prevent activity marker issues
				// Commands that open/close windows: join, part, quit, disconnect, etc.
				const windowManagementCommands = [
					"join",
					"part",
					"quit",
					"disconnect",
					"close",
					"wc",
				];
				const cmdName = finalCommand.split(" ")[0].toLowerCase();
				if (windowManagementCommands.includes(cmdName)) {
					this.sendWindowCommand(network.serverTag);
				}
			} else {
				// Regular message - find channel in ALL networks
				let channel: Chan | undefined;
				let network: NetworkData | undefined;

				for (const net of this.networks) {
					channel = net.channels.find((c) => c.id === data.target);
					if (channel) {
						network = net;
						break;
					}
				}

				if (!channel || !network) {
					log.warn(
						`User ${colors.bold(this.name)}: channel ${
							data.target
						} not found in any network`
					);
					return;
				}

				// Remove leading / if escaped (//)
				const messageText =
					line.charAt(0) === "/" && line.charAt(1) === "/" ? line.substring(1) : line;

				// Send message to channel with server tag
				const command = `msg ${channel.name} ${messageText}`;
				await this.irssiConnection.executeCommand(command, network.serverTag);
				log.debug(
					`User ${colors.bold(this.name)}: sent message to ${channel.name} on ${
						network.serverTag
					}`
				);
			}
		}
	}

	/**
	 * Command Translation Layer
	 * Translates Vue/The Lounge specific commands to irssi-compatible commands
	 * Returns:
	 * - null: no translation needed, use original command
	 * - string: translated command to send to irssi
	 * - false: command was handled, don't forward to irssi
	 */
	private async translateCommand(
		command: string,
		args: string[],
		channel: Chan,
		network: NetworkData
	): Promise<string | false | null> {
		const {ChanType} = await import("../shared/types/chan");

		switch (command) {
			case "close":
				// /close → translate based on channel type
				if (channel.type === ChanType.CHANNEL) {
					// For channels: /part #channel
					log.info(
						`[CommandTranslator] /close → /part ${channel.name} (channel) on ${network.serverTag}`
					);
					return `part ${channel.name}`;
				} else if (channel.type === ChanType.QUERY) {
					// For queries: send close_query message to irssi
					log.info(
						`[CommandTranslator] /close → close_query ${channel.name} (query) on ${network.serverTag}`
					);
					this.irssiConnection?.send({
						type: "close_query" as any,
						server: network.serverTag,
						nick: channel.name,
					});
					// Send /window 1 after closing query
					this.sendWindowCommand(network.serverTag);
					return false; // Handled
				}
				break;

			case "kick":
			case "kickban":
				// /kick nick [reason] → /kick #channel nick [reason]
				// /kickban nick [reason] → /kickban #channel nick [reason]
				if (channel.type === ChanType.CHANNEL && args.length > 0) {
					const translated = `${command} ${channel.name} ${args.join(" ")}`;
					log.info(
						`[CommandTranslator] /${command} ${args.join(" ")} → /${translated} on ${
							network.serverTag
						}`
					);
					return translated;
				}
				break;

			case "ban":
			case "unban":
				// /ban nick → /ban #channel nick
				// /unban nick → /unban #channel nick
				if (channel.type === ChanType.CHANNEL && args.length > 0) {
					const translated = `${command} ${channel.name} ${args.join(" ")}`;
					log.info(
						`[CommandTranslator] /${command} ${args.join(" ")} → /${translated} on ${
							network.serverTag
						}`
					);
					return translated;
				}
				break;

			case "invite":
				// /invite nick → /invite nick #channel
				if (channel.type === ChanType.CHANNEL && args.length === 1) {
					const translated = `invite ${args[0]} ${channel.name}`;
					log.info(
						`[CommandTranslator] /invite ${args[0]} → /${translated} on ${network.serverTag}`
					);
					return translated;
				}
				break;

			case "banlist":
				// /banlist → /mode #channel +b
				log.info(
					`[CommandTranslator] /banlist → /mode ${channel.name} +b on ${network.serverTag}`
				);
				return `mode ${channel.name} +b`;

			case "mode":
				// /mode +o nick → /mode #channel +o nick
				// /mode -v nick → /mode #channel -v nick
				if (channel.type === ChanType.CHANNEL && args.length > 0) {
					// Check if first arg is a mode string (starts with + or -)
					if (args[0].startsWith("+") || args[0].startsWith("-")) {
						const translated = `mode ${channel.name} ${args.join(" ")}`;
						log.info(
							`[CommandTranslator] /mode ${args.join(" ")} → /${translated} on ${
								network.serverTag
							}`
						);
						return translated;
					}
				}
				break;

			case "op":
			case "deop":
			case "voice":
			case "devoice":
			case "hop":
			case "dehop":
				// /op nick → /mode #channel +o nick
				// /deop nick → /mode #channel -o nick
				// /voice nick → /mode #channel +v nick
				// /devoice nick → /mode #channel -v nick
				// /hop nick → /mode #channel +h nick
				// /dehop nick → /mode #channel -h nick
				if (channel.type === ChanType.CHANNEL && args.length > 0) {
					const modeMap: {[key: string]: string} = {
						op: "+o",
						deop: "-o",
						voice: "+v",
						devoice: "-v",
						hop: "+h",
						dehop: "-h",
					};
					const modeString = modeMap[command];
					const translated = `mode ${channel.name} ${modeString} ${args.join(" ")}`;
					log.info(
						`[CommandTranslator] /${command} ${args.join(" ")} → /${translated} on ${
							network.serverTag
						}`
					);
					return translated;
				}
				break;

			case "me":
			case "slap":
				// /me text → /action #channel text (irssi /me requires active_item context which we don't have via WebSocket)
				// /slap nick → /action #channel slaps nick around a bit with a large trout
				if (channel.type === ChanType.CHANNEL || channel.type === ChanType.QUERY) {
					let text = args.join(" ");
					if (command === "slap" && args.length > 0) {
						text = `slaps ${args[0]} around a bit with a large trout`;
					}
					const translated = `action ${channel.name} ${text}`;
					log.info(
						`[CommandTranslator] /${command} ${args.join(" ")} → /${translated} on ${
							network.serverTag
						}`
					);
					return translated;
				}
				break;

			case "msg":
			case "query":
				// /msg nick message → create query window if needed, then send message
				// /query nick [message] → create query window if needed, optionally send message
				if (args.length > 0) {
					const targetNick = args[0];
					const message = args.slice(1).join(" ");

					// Check if query window already exists
					let queryChannel = network.channels.find(
						(c) =>
							c.type === ChanType.QUERY &&
							c.name.toLowerCase() === targetNick.toLowerCase()
					);

					// If query doesn't exist, create it
					if (!queryChannel) {
						const {ChanState} = await import("../shared/types/chan");
						queryChannel = new Chan({
							name: targetNick,
							type: ChanType.QUERY,
							state: ChanState.JOINED,
						});

						// Get next channel ID from feWebAdapter
						if (!this.feWebAdapter) {
							log.error("[CommandTranslator] feWebAdapter not initialized");
							return null;
						}
						queryChannel.id = this.feWebAdapter.getNextChannelId();

						// Add to network using sorted insertion
						const Network = (await import("./models/network")).default;
						if (network instanceof Network) {
							network.addChannel(queryChannel);
						} else {
							// For NetworkData, just push (sorting is handled in feWebAdapter)
							network.channels.push(queryChannel);
						}

						// Broadcast to all browsers
						this.broadcastToAllBrowsers("join", {
							shouldOpen: command === "query", // Open window for /query, not for /msg
							index: queryChannel.id,
							network: network.uuid,
							chan: queryChannel.getFilteredClone(true) as any,
						});

						log.info(
							`[CommandTranslator] Created query window for ${targetNick} on ${network.serverTag}`
						);

						// IMPORTANT: Send /query to irssi to create query window there too
						// This ensures synchronization between Vue and erssi
						const queryCmd = `query ${targetNick}`;
						log.info(
							`[CommandTranslator] Sending /query ${targetNick} to irssi for synchronization`
						);
						// Send in background (don't wait for response)
						this.irssiConnection?.executeCommand(queryCmd, network.serverTag);
						// Send /window 1 after creating query
						this.sendWindowCommand(network.serverTag);
					}

					// If there's a message, send it
					if (message) {
						const translated = `msg ${targetNick} ${message}`;
						log.info(
							`[CommandTranslator] /${command} ${args.join(
								" "
							)} → /${translated} on ${network.serverTag}`
						);
						return translated;
					} else {
						// No message - query window already created and synced to irssi
						log.info(
							`[CommandTranslator] /${command} ${targetNick} → query window created and synced`
						);
						return false; // Don't send to irssi (already sent above if needed)
					}
				}
				break;

			case "quit":
				// /quit in lobby → /disconnect (for this network only!)
				if (channel.type === ChanType.LOBBY) {
					log.info(
						`[CommandTranslator] /quit → /disconnect (lobby) on ${network.serverTag}`
					);
					// irssi command: /disconnect <server_tag>
					return `disconnect ${network.serverTag}`;
				}
				// /quit in channel/query → pass through (normal IRC quit)
				break;

			case "whois":
			case "wii":
				// /whois nick → /whois nick nick (double nick for full info including idle time)
				// /wii is alias for /whois
				if (args.length === 1) {
					const nick = args[0];
					const translated = `whois ${nick} ${nick}`;
					log.info(
						`[CommandTranslator] /${command} ${nick} → /${translated} on ${network.serverTag}`
					);
					return translated;
				}
				// If more than 1 arg, pass through (user might be doing /whois server nick)
				break;
		}

		return null; // No translation needed
	}

	/**
	 * Get message history for a channel (lazy loading)
	 * ALWAYS loads from storage (not from cache!)
	 */
	async more(data: {target: number; lastTime: number; condensed?: boolean}): Promise<{
		chan: number;
		messages: Msg[];
		totalMessages: number;
	} | null> {
		// Find channel by ID across all networks
		let targetChannel: Chan | null = null;
		let targetNetwork: NetworkData | null = null;

		for (const network of this.networks) {
			const channel = network.channels.find((c) => c.id === data.target);
			if (channel) {
				targetChannel = channel;
				targetNetwork = network;
				break;
			}
		}

		if (!targetChannel || !targetNetwork) {
			log.warn(`User ${colors.bold(this.name)}: channel ${data.target} not found for more`);
			return null;
		}

		// ALWAYS load from storage (not from cache!)
		if (!this.messageStorage) {
			log.warn(
				`User ${colors.bold(this.name)}: message storage not enabled, returning empty`
			);
			return {
				chan: data.target,
				messages: [],
				totalMessages: 0,
			};
		}

		let messages: Msg[] = [];

		try {
			if (data.lastTime < 0) {
				// Initial load - last 100 messages
				messages = await this.messageStorage.getLastMessages(
					targetNetwork.uuid,
					targetChannel.name,
					100
				);
			} else {
				// Lazy load - 100 messages before lastTime (timestamp in milliseconds)
				messages = await this.messageStorage.getMessagesBefore(
					targetNetwork.uuid,
					targetChannel.name,
					data.lastTime,
					100
				);
			}

			// Assign IDs to messages
			for (const msg of messages) {
				msg.id = this.nextMessageId();
			}

			// Get total count
			const totalMessages = await this.messageStorage.getMessageCount(
				targetNetwork.uuid,
				targetChannel.name
			);

			log.debug(
				`User ${colors.bold(this.name)}: loaded ${messages.length} messages for channel ${
					data.target
				} (total: ${totalMessages})`
			);

			return {
				chan: data.target,
				messages: messages,
				totalMessages: totalMessages,
			};
		} catch (err) {
			log.error(
				`Failed to load messages for ${targetNetwork.name}/${targetChannel.name}: ${err}`
			);
			return {
				chan: data.target,
				messages: [],
				totalMessages: 0,
			};
		}
	}

	/**
	 * Attach a browser session
	 */
	attachBrowser(socket: Socket, openChannel: number = -1, token?: string): void {
		const socketId = socket.id;

		this.attachedBrowsers.set(socketId, {
			socket,
			openChannel,
		});

		log.info(
			`User ${colors.bold(this.name)}: browser attached (${socketId}), total: ${
				this.attachedBrowsers.size
			}`
		);

		// Three cases:
		// 1. Networks exist (second+ browser) → send init NOW with cached data
		// 2. No irssi password configured → send EMPTY init (allow user to configure in Settings)
		// 3. Irssi password configured but not connected yet → wait for state_dump
		if (this.networks.length > 0) {
			log.info(
				`User ${colors.bold(this.name)}: sending init to new browser ${socketId} (${
					this.networks.length
				} networks)`
			);
			void this.sendInitialState(socket, token);
		} else if (!this.config.irssiConnection.passwordEncrypted) {
			log.info(
				`User ${colors.bold(
					this.name
				)}: no irssi password configured, sending empty init to ${socketId}`
			);
			// Send empty init - user can configure irssi in Settings
			socket.emit("init", {
				networks: [],
				active: -1,
				token: token,
			});
		} else {
			// Irssi configured but no networks yet - send empty init with status
			const isConnected = this.irssiConnection?.isConnected() ?? false;
			log.info(
				`User ${colors.bold(this.name)}: sending empty init to ${socketId} (irssi ${
					isConnected ? "connecting" : "NOT connected"
				})`
			);
			socket.emit("init", {
				networks: [],
				active: -1,
				token: token,
			});
		}
	}

	/**
	 * Detach a browser session
	 */
	detachBrowser(socketId: string): void {
		this.attachedBrowsers.delete(socketId);

		log.info(
			`User ${colors.bold(this.name)}: browser detached (${socketId}), remaining: ${
				this.attachedBrowsers.size
			}`
		);

		// Note: We keep the irssi connection alive even if no browsers are attached
		// This is the key feature - persistent connection!
	}

	/**
	 * Send initial state to a newly attached browser
	 * Converts NetworkData[] to SharedNetwork[] format for frontend
	 * LOADS 100 LAST MESSAGES from storage for each channel/query
	 */
	private async sendInitialState(socket: Socket, token?: string): Promise<void> {
		try {
			log.info(`[IrssiClient] ⏰ TIMING: sendInitialState() START for socket ${socket.id}`);

			// STEP 0: Defensive check - ensure unread markers are loaded from storage
			// This handles the edge case where sendInitialState() is called before handleInit()
			if (this.messageStorage && this.unreadMarkers.size === 0) {
				log.info(
					`[IrssiClient] Unread markers not loaded yet, loading from storage (defensive check)...`
				);
				try {
					const markers = await this.messageStorage.loadUnreadMarkers();
					for (const [key, lastReadTime] of markers) {
						const [networkUuid, channelName] = key.split(":");
						this.unreadMarkers.set(key, {
							network: networkUuid,
							channel: channelName,
							unreadCount: 0,
							lastReadTime: lastReadTime,
							lastMessageTime: 0,
							dataLevel: DataLevel.NONE,
						});
					}
					log.info(
						`[IrssiClient] Loaded ${markers.size} unread markers (defensive check)`
					);
				} catch (err) {
					log.error(`Failed to load unread markers in sendInitialState: ${err}`);
				}
			}

			// STEP 1: Load messages from storage for each channel/query
			if (this.messageStorage) {
				log.info(
					`[IrssiClient] Loading messages from storage for ${this.networks.length} networks...`
				);

				for (const network of this.networks) {
					for (const channel of network.channels) {
						try {
							// Get total message count from storage
							const totalCount = await this.messageStorage.getMessageCount(
								network.uuid,
								channel.name
							);

							// Load last 100 messages from encrypted storage
							const messages = await this.messageStorage.getLastMessages(
								network.uuid,
								channel.name,
								100
							);

							// Assign IDs to messages
							for (const msg of messages) {
								msg.id = this.nextMessageId();
							}

							// TEMPORARILY add to channel.messages (only for this init!)
							channel.messages = messages;

							// Store total count for getFilteredClone to use
							channel.totalMessagesInStorage = totalCount;

							// Set firstUnread based on lastReadTime from unread markers
							const key = this.getMarkerKey(network.uuid, channel.name);
							const marker = this.unreadMarkers.get(key);

							if (marker && marker.lastReadTime > 0 && messages.length > 0) {
								// Find first message AFTER lastReadTime
								const firstUnreadMsg = messages.find(
									(msg) => msg.time.getTime() > marker.lastReadTime
								);

								if (firstUnreadMsg) {
									channel.firstUnread = firstUnreadMsg.id;
									log.debug(
										`[IrssiClient] Set firstUnread=${firstUnreadMsg.id} for ${
											network.name
										}/${channel.name} (lastReadTime=${new Date(
											marker.lastReadTime
										).toISOString()})`
									);
								} else {
									// All messages are read, set to last message
									channel.firstUnread = messages[messages.length - 1].id;
									log.debug(
										`[IrssiClient] All messages read for ${network.name}/${channel.name}, set firstUnread to last message`
									);
								}
							} else if (messages.length > 0) {
								// No marker or marker is 0 - set to last message (all unread)
								channel.firstUnread = messages[0].id;
								log.debug(
									`[IrssiClient] No marker for ${network.name}/${channel.name}, set firstUnread to first message`
								);
							}

							log.debug(
								`[IrssiClient] Loaded ${messages.length}/${totalCount} messages for ${network.name}/${channel.name}`
							);
						} catch (err) {
							log.error(
								`Failed to load messages for ${network.name}/${channel.name}: ${err}`
							);
							channel.messages = [];
							channel.totalMessagesInStorage = 0;
						}
					}
				}
			}

			// STEP 2: Convert NetworkData[] to SharedNetwork[] for Socket.IO
			const sharedNetworks = this.networks.map((net) => {
				// Serialize Prefix class to plain object for JSON
				const serverOptions = {
					CHANTYPES: net.serverOptions.CHANTYPES,
					PREFIX: {
						prefix: net.serverOptions.PREFIX.prefix,
						modeToSymbol: net.serverOptions.PREFIX.modeToSymbol,
						symbols: net.serverOptions.PREFIX.symbols,
					},
					NETWORK: net.serverOptions.NETWORK,
				};

				return {
					uuid: net.uuid,
					name: net.name,
					nick: net.nick,
					serverOptions: serverOptions,
					status: {
						connected: net.connected,
						secure: true,
					},
					channels: net.channels.map((ch) => ch.getFilteredClone(true)), // Contains messages!
				};
			}) as any[];

			// STEP 3: Clear messages from cache (we don't keep them in memory!)
			for (const network of this.networks) {
				for (const channel of network.channels) {
					channel.messages = [];
					channel.totalMessagesInStorage = undefined; // Clear cached count
				}
			}

			// STEP 4: Send init event to browser
			socket.emit("init", {
				networks: sharedNetworks,
				token: token,
				active: this.lastActiveChannel || -1,
			});

			log.info(
				`[IrssiClient] ⏰ TIMING: sendInitialState() SENT init event for socket ${socket.id} with ${sharedNetworks.length} networks`
			);

			// Send names event for each channel with users
			// This ensures frontend has nicklist data immediately after init
			for (const net of this.networks) {
				for (const channel of net.channels) {
					if (channel.users.size > 0) {
						const usersArray = Array.from(channel.users.values());
						socket.emit("names", {
							id: channel.id,
							users: usersArray,
						});
						log.debug(
							`[IrssiClient] Sent names for channel ${channel.id} (${usersArray.length} users) in init`
						);
					}
				}
			}

			// STEP 5: Send activity_update for channels with unread markers
			// This ensures frontend shows activity status from irssi immediately
			// Count unread from message storage (messages newer than lastReadTime)
			for (const net of this.networks) {
				for (const channel of net.channels) {
					const key = this.getMarkerKey(net.uuid, channel.name);
					const marker = this.unreadMarkers.get(key);

					if (marker && marker.dataLevel > DataLevel.NONE) {
						// Count unread from DB (messages after lastReadTime)
						let unreadCount = marker.unreadCount;
						if (this.messageStorage) {
							try {
								unreadCount = await this.messageStorage.getUnreadCount(
									net.uuid,
									channel.name,
									marker.lastReadTime
								);
								marker.unreadCount = unreadCount;
								this.unreadMarkers.set(key, marker);
							} catch (err) {
								log.error(
									`Failed to get unread count for ${net.name}/${channel.name}: ${err}`
								);
							}
						}

						socket.emit("activity_update", {
							chan: channel.id,
							unread: unreadCount,
							highlight: marker.dataLevel === DataLevel.HILIGHT ? unreadCount : 0,
						});
						log.debug(
							`[IrssiClient] Sent activity_update for channel ${channel.id} (unread=${unreadCount}, level=${marker.dataLevel}) in init`
						);
					}
				}
			}

			log.info(`User ${colors.bold(this.name)}: sent initial state to browser ${socket.id}`);
		} catch (error) {
			log.error(`Failed to send initial state to browser ${socket.id}: ${error}`);
		}
	}

	/**
	 * Broadcast event to all attached browsers
	 */
	private broadcastToAllBrowsers<Ev extends keyof ServerToClientEvents>(
		event: Ev,
		...args: Parameters<ServerToClientEvents[Ev]>
	): void {
		for (const [socketId, session] of this.attachedBrowsers) {
			session.socket.emit(event, ...args);
		}
	}

	/**
	 * Emit event to all attached browsers (alias for compatibility)
	 */
	emit<Ev extends keyof ServerToClientEvents>(
		event: Ev,
		...args: Parameters<ServerToClientEvents[Ev]>
	): void {
		this.broadcastToAllBrowsers(event, ...args);
	}

	/**
	 * Disconnect from irssi and cleanup
	 */
	async quit(shouldSave = true): Promise<void> {
		log.info(`User ${colors.bold(this.name)} quitting...`);

		// Disconnect all browsers
		for (const [socketId, session] of this.attachedBrowsers) {
			session.socket.disconnect(true);
		}
		this.attachedBrowsers.clear();

		// Stop WeeChat Relay server
		if (this.weechatRelayServer) {
			await this.stopWeeChatRelay();
		}

		// Disconnect from irssi
		if (this.irssiConnection) {
			await this.irssiConnection.disconnect();
			this.irssiConnection = null;
		}

		// Close message storage
		if (this.messageStorage) {
			await this.messageStorage.close();
			this.messageStorage = null;
		}

		// Clear sensitive data from memory
		if (this.encryptionKey) {
			this.encryptionKey.fill(0); // Overwrite with zeros
			this.encryptionKey = null;
		}

		this.irssiPassword = null;
		this.userPassword = null;

		if (shouldSave) {
			this.manager.saveUser(this as any); // IrssiClient is compatible with Client interface
		}

		log.info(`User ${colors.bold(this.name)} quit successfully`);
	}

	/**
	 * Create a channel (for compatibility with frontend)
	 */
	createChannel(attr: Partial<Chan>): Chan {
		const chan = new Chan(attr);
		chan.id = this.idChan++;
		return chan;
	}

	/**
	 * Get next message ID
	 */
	nextMessageId(): number {
		return this.idMsg++;
	}

	/**
	 * Generate authentication token
	 */
	generateToken(callback: (token: string) => void): void {
		crypto.randomBytes(64, (err, buf) => {
			if (err) {
				throw err;
			}
			callback(buf.toString("hex"));
		});
	}

	/**
	 * Calculate token hash (SHA-512)
	 */
	calculateTokenHash(token: string): string {
		return crypto.createHash("sha512").update(token).digest("hex");
	}

	/**
	 * Update session information
	 */
	updateSession(token: string, ip: string, request: any): void {
		const agent = UAParser(request.headers["user-agent"] || "");
		let friendlyAgent = "";

		if (agent.browser.name) {
			friendlyAgent = `${agent.browser.name} ${agent.browser.major || ""}`;
		} else {
			friendlyAgent = "Unknown browser";
		}

		if (agent.os.name) {
			friendlyAgent += ` on ${agent.os.name}`;

			if (agent.os.version) {
				friendlyAgent += ` ${agent.os.version}`;
			}
		}

		this.config.sessions[token] = _.assign(this.config.sessions[token] || {}, {
			lastUse: Date.now(),
			ip: ip,
			agent: friendlyAgent,
		});

		this.save();
	}

	/**
	 * Save user config to disk
	 */
	save(): void {
		this.manager.saveUser(this as any); // IrssiClient is compatible with Client interface
	}

	/**
	 * Set The Lounge password (login password, NOT irssi password!)
	 */
	setPassword(hash: string, callback: (success: boolean) => void): void {
		const oldHash = this.config.password;
		this.config.password = hash;

		this.manager.saveUser(this as any, (err) => {
			if (err) {
				// If user file fails to write, reset it back
				this.config.password = oldHash;
				return callback(false);
			}

			return callback(true);
		});
	}

	// Unread marker helpers

	/**
	 * Get marker key for Map lookup (network:channel lowercase)
	 */
	private getMarkerKey(network: string, channel: string): string {
		return `${network}:${channel.toLowerCase()}`;
	}

	/**
	 * Handle ACTIVITY_UPDATE from irssi (channel/query got new activity)
	 * Updates unread marker and broadcasts to all browsers
	 */
	private handleActivityUpdate(msg: FeWebMessage): void {
		// irssi sends "server" and "channel" fields (not "server_tag" and "target")
		const serverTag = msg.server || msg.server_tag;
		const channelName = msg.channel || msg.target;

		if (!serverTag || !channelName) {
			log.warn(
				`[IrssiClient] Invalid ACTIVITY_UPDATE message (missing server/channel): ${JSON.stringify(
					msg
				)}`
			);
			return;
		}

		// Find network by server_tag
		const network = this.networks.find((n) => n.serverTag === serverTag);
		if (!network) {
			log.warn(`[IrssiClient] ACTIVITY_UPDATE for unknown server: ${serverTag}`);
			return;
		}

		// Find channel by name
		const channel = network.channels.find(
			(c) => c.name.toLowerCase() === channelName.toLowerCase()
		);
		if (!channel) {
			log.warn(
				`[IrssiClient] ACTIVITY_UPDATE for unknown channel: ${channelName} on ${serverTag}`
			);
			return;
		}

		// Check if channel is open in any browser (for 1:1 sync)
		// If channel is open anywhere, ignore activity_update from irssi
		const isChannelOpen = this.isChannelOpenInAnyBrowser(channel.id);
		if (isChannelOpen) {
			log.debug(
				`[IrssiClient] Ignoring activity_update for ${network.name}/${channel.name} (channel is open in browser)`
			);
			return;
		}

		const key = this.getMarkerKey(network.uuid, channel.name);
		const dataLevel = msg.level || DataLevel.NONE;

		// Update or create unread marker
		const marker = this.unreadMarkers.get(key) || {
			network: network.uuid,
			channel: channel.name,
			unreadCount: 0,
			lastReadTime: 0,
			lastMessageTime: Date.now(),
			dataLevel: DataLevel.NONE,
		};

		marker.dataLevel = dataLevel;
		marker.lastMessageTime = Date.now();

		// Update unread count based on activity level
		// NOTE: irssi sends activity LEVEL (0-3), not message COUNT
		// We DON'T increment here - instead we count messages in DB that are newer than lastReadTime
		if (dataLevel === DataLevel.NONE) {
			// Marked as read - update lastReadTime and clear count
			// This is sent when user switches to this window in irssi (sig_window_changed)
			marker.lastReadTime = Date.now();
			marker.unreadCount = 0;
			this.unreadMarkers.set(key, marker);

			// Update activeWindowInIrssi (user switched to this window in irssi)
			this.activeWindowInIrssi = key;

			log.debug(
				`[IrssiClient] Activity cleared: ${network.name}/${channel.name} level=0 unread=0 (active in irssi)`
			);

			// Broadcast to all browsers - clear activity
			this.broadcastToAllBrowsers("activity_update" as any, {
				chan: channel.id,
				unread: 0,
				highlight: 0,
			});
			return; // Done - no need to query DB
		} else {
			// New activity (level > 0) - this channel is NO LONGER active in irssi!
			// Clear activeWindowInIrssi if it was pointing to this channel
			if (this.activeWindowInIrssi === key) {
				log.debug(
					`[IrssiClient] Channel ${network.name}/${channel.name} is no longer active in irssi (got activity level=${dataLevel})`
				);
				this.activeWindowInIrssi = null;
			}
			// New activity - count unread from message storage
			if (this.messageStorage) {
				this.messageStorage
					.getUnreadCount(network.uuid, channel.name, marker.lastReadTime)
					.then((count) => {
						marker.unreadCount = count;
						this.unreadMarkers.set(key, marker);

						log.debug(
							`[IrssiClient] Activity update: ${network.name}/${channel.name} level=${dataLevel} unread=${count} (from DB)`
						);

						// Broadcast to all browsers with actual count from DB
						this.broadcastToAllBrowsers("activity_update" as any, {
							chan: channel.id,
							unread: count,
							highlight: dataLevel === DataLevel.HILIGHT ? count : 0,
						});
					})
					.catch((err) => {
						log.error(
							`Failed to get unread count for ${network.name}/${channel.name}: ${err}`
						);
						// Fallback: use old increment logic
						marker.unreadCount++;
						this.unreadMarkers.set(key, marker);

						this.broadcastToAllBrowsers("activity_update" as any, {
							chan: channel.id,
							unread: marker.unreadCount,
							highlight: dataLevel === DataLevel.HILIGHT ? marker.unreadCount : 0,
						});
					});
				return; // Don't broadcast yet - wait for DB query
			} else {
				// No message storage - fallback to increment
				marker.unreadCount++;
			}
		}

		this.unreadMarkers.set(key, marker);

		log.debug(
			`[IrssiClient] Activity update: ${network.name}/${channel.name} level=${dataLevel} unread=${marker.unreadCount}`
		);

		// Broadcast to all browsers
		this.broadcastToAllBrowsers("activity_update" as any, {
			chan: channel.id,
			unread: marker.unreadCount,
			highlight: dataLevel === DataLevel.HILIGHT ? marker.unreadCount : 0,
		});
	}

	/**
	 * Check if channel is open in any browser
	 */
	private isChannelOpenInAnyBrowser(channelId: number): boolean {
		for (const [socketId, session] of this.attachedBrowsers) {
			if (session.openChannel === channelId) {
				log.debug(`[IrssiClient] Channel ${channelId} is open in browser ${socketId}`);
				return true;
			}
		}
		return false;
	}

	/**
	 * Handle browser opening a channel (switching to a channel)
	 * Updates openChannel and marks as read
	 */
	open(socketId: string, channelId: number): void {
		const session = this.attachedBrowsers.get(socketId);
		if (!session) {
			log.warn(`[IrssiClient] open() called for unknown browser ${socketId}`);
			return;
		}

		// Update openChannel for this browser
		session.openChannel = channelId;

		log.debug(`[IrssiClient] Browser ${socketId} opened channel ${channelId}`);

		// Find network and channel by channel ID
		for (const network of this.networks) {
			const channel = network.channels.find((c) => c.id === channelId);
			if (channel) {
				log.debug(
					`[IrssiClient] Found channel ${network.name}/${channel.name} for ID ${channelId}, calling markAsRead()`
				);
				// Mark as read (this will broadcast to all browsers and send to irssi)
				this.markAsRead(network.uuid, channel.name);
				return;
			}
		}

		log.warn(`[IrssiClient] Channel ${channelId} not found in any network!`);
	}

	/**
	 * Mark channel as read (from browser or irssi)
	 * Clears unread marker and broadcasts to all browsers
	 *
	 * @param fromIrssi - true if mark_read came from irssi (window switch), false if from browser
	 */
	markAsRead(network: string, channel: string, fromIrssi: boolean = false): void {
		log.debug(
			`[IrssiClient] markAsRead() called: ${network}/${channel} (fromIrssi=${fromIrssi})`
		);

		const key = this.getMarkerKey(network, channel);
		const marker = this.unreadMarkers.get(key);

		if (marker) {
			marker.dataLevel = DataLevel.NONE;
			marker.unreadCount = 0;
			marker.lastReadTime = Date.now();
			this.unreadMarkers.set(key, marker);

			// Persist to storage (async - don't block!)
			if (this.messageStorage) {
				this.messageStorage
					.saveUnreadMarker(network, channel, marker.lastReadTime)
					.catch((err) => {
						log.error(`Failed to save unread marker for ${network}/${channel}: ${err}`);
					});
			}
		} else {
			log.debug(`[IrssiClient] No marker found for ${network}/${channel}, creating new one`);
		}

		log.debug(`[IrssiClient] Marked as read: ${network}/${channel} (fromIrssi=${fromIrssi})`);

		// If mark_read came from irssi, update activeWindowInIrssi
		if (fromIrssi) {
			this.activeWindowInIrssi = key;
			log.debug(`[IrssiClient] Active window in irssi: ${key}`);
		}

		// Find network and channel IDs for broadcast
		const net = this.networks.find((n) => n.uuid === network);
		if (net) {
			const chan = net.channels.find((c) => c.name.toLowerCase() === channel.toLowerCase());
			if (chan) {
				// Broadcast to all browsers
				this.broadcastToAllBrowsers("activity_update" as any, {
					chan: chan.id,
					unread: 0,
					highlight: 0,
				});

				// Send mark_read to irssi ONLY if NOT from irssi
				// This prevents infinite loop and unnecessary window switches
				if (this.irssiConnection && !fromIrssi) {
					log.debug(
						`[IrssiClient] Preparing to send mark_read to irssi (connection exists, fromIrssi=${fromIrssi})`
					);
					// Check if actually connected before sending
					if (this.irssiConnection.isConnected()) {
						this.irssiConnection.send({
							type: "mark_read" as any,
							server: net.serverTag,
							target: chan.name,
						});
						log.debug(
							`[IrssiClient] ✅ Sent mark_read to irssi for ${net.serverTag}/${chan.name}`
						);
					} else {
						log.debug(
							`[IrssiClient] ❌ Skipping mark_read for ${net.serverTag}/${chan.name} (not connected)`
						);
					}
				} else {
					log.debug(
						`[IrssiClient] ❌ NOT sending mark_read to irssi (connection=${!!this
							.irssiConnection}, fromIrssi=${fromIrssi})`
					);
				}
			}
		}
	}

	/**
	 * Handle mark_read from irssi (user switched window in irssi)
	 * Syncs read status to all browsers
	 */
	private handleMarkReadFromIrssi(networkUuid: string, channelName: string): void {
		log.info(
			`[IrssiClient] Mark read from irssi: ${networkUuid}/${channelName} - syncing to all clients`
		);

		// Mark as read (fromIrssi=true prevents sending back to irssi)
		this.markAsRead(networkUuid, channelName, true);
	}

	/**
	 * Handle query_closed from irssi (query window closed in irssi)
	 * Removes query from network and broadcasts to all browsers (2-way sync)
	 */
	private async handleQueryClosed(msg: FeWebMessage): Promise<void> {
		const serverTag = msg.server || msg.server_tag;
		const nick = msg.nick;

		if (!serverTag || !nick) {
			log.warn(
				`[IrssiClient] Invalid query_closed message (missing server/nick): ${JSON.stringify(
					msg
				)}`
			);
			return;
		}

		// Find network by server_tag
		const network = this.networks.find((n) => n.serverTag === serverTag);
		if (!network) {
			log.warn(`[IrssiClient] query_closed for unknown server: ${serverTag}`);
			return;
		}

		// Import ChanType dynamically
		const {ChanType} = await import("../shared/types/chan");

		// Find query by nick
		const query = network.channels.find(
			(c) => c.type === ChanType.QUERY && c.name.toLowerCase() === nick.toLowerCase()
		);

		if (!query) {
			log.warn(`[IrssiClient] query_closed for unknown query: ${nick} on ${serverTag}`);
			return;
		}

		log.info(`[IrssiClient] Query closed in irssi: ${nick} on ${serverTag}`);

		// Remove query from network
		const index = network.channels.indexOf(query);
		if (index !== -1) {
			network.channels.splice(index, 1);
		}

		// Broadcast to all browsers (close query window in frontend)
		this.broadcastToAllBrowsers("part", {
			chan: query.id,
		});

		log.debug(`[IrssiClient] Broadcasted part for query ${query.id} (${nick}) to all browsers`);
	}

	// FeWebAdapter callback handlers

	private handleNetworkUpdate(network: NetworkData): void {
		log.debug(
			`[IrssiClient] Network update: ${network.name} (connected: ${network.connected})`
		);

		// Update networks array
		const index = this.networks.findIndex((n) => n.uuid === network.uuid);
		const isNewNetwork = index === -1;

		if (index !== -1) {
			this.networks[index] = network;
		} else {
			this.networks.push(network);
		}

		// If this is a new network that just connected, send full network to frontend
		// This happens when user connects to a server via /CONNECT or NetworkManager
		if (isNewNetwork && network.connected) {
			log.info(`[IrssiClient] New network connected: ${network.name} - sending to frontend`);

			// Send network event to all browsers (so they add it to the network list)
			// Use the same format as Client.connect() uses (server/client.ts:350)
			this.broadcastToAllBrowsers("network", {
				network: {
					uuid: network.uuid,
					name: network.name,
					nick: network.nick || "",
					serverOptions: network.serverOptions || {},
					status: {
						connected: network.connected,
						secure: true,
					},
					channels: network.channels.map((chan) => chan.getFilteredClone(true)),
				},
			});
		}

		// Always broadcast status update
		this.broadcastToAllBrowsers("network:status", {
			network: network.uuid,
			connected: network.connected,
			secure: true, // irssi connection is always secure (wss:// + AES-256-GCM)
		});
	}

	private handleMessage(networkUuid: string, channelId: number, msg: Msg): void {
		log.debug(`[IrssiClient] Message: ${msg.text?.substring(0, 50)}`);

		const network = this.networks.find((n) => n.uuid === networkUuid);
		const channel = network?.channels.find((c) => c.id === channelId);

		// Save to encrypted storage (ASYNC - don't block!)
		// Only save loggable messages (skip TOPIC without nick, MODE_CHANNEL, etc.)
		if (this.messageStorage && network && channel && msg.isLoggable()) {
			// Create minimal Network object (only uuid and name needed for storage)
			const networkForStorage = {
				uuid: network.uuid,
				name: network.name,
			} as Network;

			// Create minimal Channel object (only name needed for storage)
			const channelForStorage = {
				name: channel.name,
			} as Chan;

			// Save encrypted to SQLite (async - don't await!)
			this.messageStorage.index(networkForStorage, channelForStorage, msg).catch((err) => {
				log.error(
					`Failed to save message to storage for ${network.name}/${channel.name}: ${err}`
				);
			});
		}

		// Detect highlight (mention of user's nick)
		const isHighlight =
			network && msg.text
				? msg.text.toLowerCase().includes(network.nick.toLowerCase())
				: false;

		// Check if channel is open in any browser OR active in irssi
		// If channel is open anywhere (browser or irssi), treat as read for ALL clients
		const isChannelOpenInBrowser = this.isChannelOpenInAnyBrowser(channelId);
		const key = network && channel ? this.getMarkerKey(network.uuid, channel.name) : null;
		const isChannelActiveInIrssi = key === this.activeWindowInIrssi;
		const isChannelOpen = isChannelOpenInBrowser || isChannelActiveInIrssi;

		// Broadcast to all browsers (live update)
		this.broadcastToAllBrowsers("msg", {
			chan: channelId,
			msg: msg,
			unread: msg.self || isChannelOpen ? 0 : 1, // If open anywhere (browser OR irssi), unread=0
			highlight: isHighlight && !msg.self ? 1 : 0,
		});

		// If channel is open in browser (NOT irssi), mark as read in irssi immediately
		// This prevents irssi from sending activity_update
		// DON'T send mark_read if channel is already active in irssi!
		if (isChannelOpenInBrowser && !isChannelActiveInIrssi && network && channel && !msg.self) {
			log.debug(
				`[IrssiClient] Channel ${channelId} is open in browser, marking as read in irssi`
			);
			this.markAsRead(network.uuid, channel.name, false); // fromIrssi=false
		}

		// Forward to WeeChat Relay (Lith clients)
		if (this.weechatErssiAdapter && network && channel) {
			// Emit event that adapter will catch
			(this.weechatErssiAdapter as any).handleNewMessage(network, channel, msg);
		}
	}

	private async handleChannelJoin(networkUuid: string, channel: Chan): Promise<void> {
		log.info(`[IrssiClient] Channel join: ${channel.name}`);

		// DON'T load messages from storage here!
		// Frontend will request them via lazy loading (more request) if needed.
		// Loading here causes duplicates when browser reconnects with existing messages in local store.
		channel.messages = [];

		// BUT we need to set totalMessagesInStorage so frontend knows there's history to load
		if (this.messageStorage) {
			try {
				const count = await this.messageStorage.getMessageCount(networkUuid, channel.name);
				channel.totalMessagesInStorage = count;
				log.debug(`[IrssiClient] Channel ${channel.name} has ${count} messages in storage`);
			} catch (err) {
				log.error(`Failed to get message count for ${channel.name}: ${err}`);
				channel.totalMessagesInStorage = 0;
			}
		}

		// Broadcast to all browsers
		// Note: join event expects SharedNetworkChan which includes network info
		this.broadcastToAllBrowsers("join", {
			shouldOpen: false,
			index: channel.id,
			network: networkUuid,
			chan: channel.getFilteredClone(true) as any, // Convert to SharedNetworkChan
		});
	}

	/**
	 * Handle part_channel from browser (client-driven channel/query close)
	 * This is the NEW client-driven flow:
	 * 1. Remove from cache IMMEDIATELY
	 * 2. Broadcast to ALL browsers IMMEDIATELY
	 * 3. Send to irssi in BACKGROUND (async confirmation)
	 */
	async handlePartChannel(
		socketId: string,
		data: {networkUuid: string; channelId: number}
	): Promise<void> {
		// Find network + channel
		const network = this.networks.find((n) => n.uuid === data.networkUuid);
		if (!network) {
			log.warn(
				`User ${colors.bold(this.name)}: Network ${
					data.networkUuid
				} not found for part_channel`
			);
			return;
		}

		const channel = network.channels.find((c) => c.id === data.channelId);
		if (!channel) {
			log.debug(
				`User ${colors.bold(this.name)}: Channel ${
					data.channelId
				} already removed (idempotent)`
			);
			return; // Already removed - idempotent!
		}

		const {ChanType} = await import("../shared/types/chan");

		log.info(
			`User ${colors.bold(this.name)}: Part channel ${channel.name} on ${
				network.name
			} (client-driven)`
		);

		// STEP 1: Remove from cache IMMEDIATELY
		const index = network.channels.indexOf(channel);
		if (index !== -1) {
			network.channels.splice(index, 1);
		}

		// STEP 2: Broadcast to ALL browsers IMMEDIATELY (including initiator - idempotent!)
		this.broadcastToAllBrowsers("part", {
			chan: data.channelId,
		});

		// STEP 3: Send to irssi in BACKGROUND (fire-and-forget)
		if (this.irssiConnection) {
			if (channel.type === ChanType.CHANNEL) {
				// Send /part for channels (executeCommand returns void)
				this.irssiConnection.executeCommand(`part ${channel.name}`, network.serverTag);
				log.debug(
					`User ${colors.bold(this.name)}: Sent /part ${
						channel.name
					} to irssi in background`
				);
			} else if (channel.type === ChanType.QUERY) {
				// Send close_query for queries
				this.irssiConnection.send({
					type: "close_query" as any,
					server: network.serverTag,
					nick: channel.name,
				});
				log.debug(
					`User ${colors.bold(this.name)}: Sent close_query for ${
						channel.name
					} to irssi in background`
				);
			}

			// Send /window 1 after closing channel/query to prevent activity marker issues
			this.sendWindowCommand(network.serverTag);
		}
	}

	private handleChannelPart(networkUuid: string, channelId: number): void {
		log.info(`[IrssiClient] Channel part: ${channelId}`);

		// Broadcast to all browsers
		this.broadcastToAllBrowsers("part", {
			chan: channelId,
		});
	}

	private handleNicklistUpdate(networkUuid: string, channelId: number, users: User[]): void {
		log.debug(`[IrssiClient] Nicklist update: ${channelId} (${users.length} users)`);

		// DON'T send 'users' event - it triggers frontend to request /names which is wasteful!
		// In irssi mode we already have the data, just send 'names' event directly

		this.broadcastToAllBrowsers("names", {
			id: channelId,
			users: users,
		});
	}

	private handleTopicUpdate(networkUuid: string, channelId: number, topic: string): void {
		log.debug(`[IrssiClient] Topic update: ${channelId}`);

		// Broadcast to all browsers
		this.broadcastToAllBrowsers("topic", {
			chan: channelId,
			topic: topic,
		});
	}

	private handleNickChange(networkUuid: string, newNick: string): void {
		log.info(`[IrssiClient] Nick change: ${networkUuid} → ${newNick}`);

		// Broadcast to all browsers
		this.broadcastToAllBrowsers("nick", {
			network: networkUuid,
			nick: newNick,
		});
	}

	private async handleInit(networks: NetworkData[]): Promise<void> {
		log.info(`[HANDLEINIT] ========================================`);
		log.info(`[HANDLEINIT] Init with ${networks.length} networks`);
		log.info(`[HANDLEINIT] BEFORE assignment: this.networks.length = ${this.networks.length}`);
		this.networks = networks;
		log.info(`[HANDLEINIT] AFTER assignment: this.networks.length = ${this.networks.length}`);
		log.info(`[HANDLEINIT] attachedBrowsers.size = ${this.attachedBrowsers.size}`);

		// Load unread markers from storage FIRST (persistent read status across restarts!)
		if (this.messageStorage) {
			log.info(`[IrssiClient] Loading unread markers from storage...`);
			try {
				const markers = await this.messageStorage.loadUnreadMarkers();

				// Populate unreadMarkers Map with loaded data
				for (const [key, lastReadTime] of markers) {
					// Parse key (format: "network_uuid:channel_name")
					const [networkUuid, channelName] = key.split(":");

					// Create marker with loaded lastReadTime
					this.unreadMarkers.set(key, {
						network: networkUuid,
						channel: channelName,
						unreadCount: 0, // Will be recalculated if needed
						lastReadTime: lastReadTime,
						lastMessageTime: 0, // Will be updated by activity_update
						dataLevel: DataLevel.NONE, // Default to read
					});
				}

				log.info(`[IrssiClient] Loaded ${markers.size} unread markers from storage`);
			} catch (err) {
				log.error(`Failed to load unread markers from storage: ${err}`);
			}
		}

		// Load messages from storage for all channels (on node restart!)
		if (this.messageStorage) {
			log.info(
				`[IrssiClient] Loading messages from storage for ${networks.length} networks...`
			);

			for (const network of networks) {
				for (const channel of network.channels) {
					try {
						const {ChanType} = await import("../shared/types/chan");

						// Don't load messages for lobby
						if (channel.type === ChanType.LOBBY) {
							continue;
						}

						// Load last 100 messages from encrypted storage
						const messages = await this.messageStorage.getLastMessages(
							network.uuid,
							channel.name,
							100
						);

						// Assign IDs to messages
						for (const msg of messages) {
							msg.id = this.nextMessageId();
						}

						// Add to channel.messages
						channel.messages = messages;

						// Set firstUnread based on lastReadTime from unread markers
						const key = this.getMarkerKey(network.uuid, channel.name);
						const marker = this.unreadMarkers.get(key);

						if (marker && marker.lastReadTime > 0 && messages.length > 0) {
							// Find first message AFTER lastReadTime
							const firstUnreadMsg = messages.find(
								(msg) => msg.time.getTime() > marker.lastReadTime
							);

							if (firstUnreadMsg) {
								channel.firstUnread = firstUnreadMsg.id;
								log.debug(
									`[IrssiClient] Set firstUnread=${firstUnreadMsg.id} for ${
										network.name
									}/${channel.name} (lastReadTime=${new Date(
										marker.lastReadTime
									).toISOString()})`
								);
							} else {
								// All messages are read, set to last message
								channel.firstUnread = messages[messages.length - 1].id;
								log.debug(
									`[IrssiClient] All messages read for ${network.name}/${channel.name}, set firstUnread to last message`
								);
							}
						} else if (messages.length > 0) {
							// No marker or marker is 0 - set to first message (all unread)
							channel.firstUnread = messages[0].id;
							log.debug(
								`[IrssiClient] No marker for ${network.name}/${channel.name}, set firstUnread to first message`
							);
						}

						log.info(
							`[IrssiClient] Loaded ${messages.length} messages for ${network.name}/${channel.name} from storage`
						);
					} catch (err) {
						log.error(
							`Failed to load messages for ${network.name}/${channel.name}: ${err}`
						);
						channel.messages = [];
					}
				}
			}
		}

		// Convert NetworkData[] to SharedNetwork[] for Socket.IO
		const sharedNetworks = networks.map((net) => {
			// Serialize Prefix class to plain object for JSON
			const serverOptions = {
				CHANTYPES: net.serverOptions.CHANTYPES,
				PREFIX: {
					prefix: net.serverOptions.PREFIX.prefix, // Extract array from Prefix class
					modeToSymbol: net.serverOptions.PREFIX.modeToSymbol,
					symbols: net.serverOptions.PREFIX.symbols,
				},
				NETWORK: net.serverOptions.NETWORK,
			};

			log.debug(
				`[IrssiClient] Network ${net.name} serverOptions:`,
				JSON.stringify(serverOptions)
			);

			return {
				uuid: net.uuid,
				name: net.name,
				nick: net.nick,
				serverOptions: serverOptions,
				status: {
					connected: net.connected,
					secure: true,
				},
				channels: net.channels.map((ch) => ch.getFilteredClone(true)),
			};
		}) as any[];

		// Log structure for debugging
		log.debug(
			`[IrssiClient] Init event structure: ${sharedNetworks.length} networks, ` +
				`channels: ${sharedNetworks
					.map((n) => `${n.name}(${n.channels.length})`)
					.join(", ")}`
		);

		// Broadcast to all browsers
		log.info(
			`[HANDLEINIT] Broadcasting init to ${this.attachedBrowsers.size} browsers with ${sharedNetworks.length} networks`
		);
		this.broadcastToAllBrowsers("init", {
			networks: sharedNetworks,
			active: -1,
		});

		log.info(`[IrssiClient] ⏰ TIMING: Sent init event with ${sharedNetworks.length} networks`);

		// Send names event for each channel with users
		// This ensures frontend has nicklist data immediately after init
		for (const net of networks) {
			for (const channel of net.channels) {
				if (channel.users.size > 0) {
					const usersArray = Array.from(channel.users.values());
					this.broadcastToAllBrowsers("names", {
						id: channel.id,
						users: usersArray,
					});
					log.info(
						`[IrssiClient] ⏰ TIMING: Sent names for channel ${channel.id} (${usersArray.length} users) after init`
					);
				}
			}
		}

		// Save network UUID map to config (persistent UUIDs across reconnects)
		if (this.feWebAdapter) {
			const uuidMap = this.feWebAdapter.getNetworkUuidMap();
			this.config.networkUuidMap = Object.fromEntries(uuidMap);
			this.manager.saveUser(this as any); // IrssiClient is compatible with Client interface
			log.info(`[IrssiClient] Saved ${uuidMap.size} network UUIDs to config for persistence`);
		}

		log.info(`[IrssiClient] ⏰ TIMING: handleInit() COMPLETED`);
	}

	/**
	 * ========================================================================
	 * NETWORK/SERVER MANAGEMENT METHODS
	 * ========================================================================
	 */

	/**
	 * Handle command_result response from irssi
	 */
	private handleCommandResult(msg: FeWebMessage): void {
		const requestId = msg.response_to;
		if (!requestId) {
			log.warn("[IrssiClient] Received command_result without response_to");
			return;
		}

		const pending = this.pendingRequests.get(requestId);
		if (!pending) {
			log.warn(`[IrssiClient] Received command_result for unknown request ${requestId}`);
			return;
		}

		clearTimeout(pending.timeout);
		this.pendingRequests.delete(requestId);

		pending.resolve({
			success: msg.success || false,
			message: msg.message || "",
			error_code: msg.error_code,
		});
	}

	/**
	 * Handle network_list_response from irssi
	 */
	private handleNetworkListResponse(msg: FeWebMessage): void {
		const requestId = msg.response_to;
		if (!requestId) {
			log.warn("[IrssiClient] Received network_list_response without response_to");
			return;
		}

		const pending = this.pendingListRequests.get(requestId);
		if (!pending) {
			log.warn(
				`[IrssiClient] Received network_list_response for unknown request ${requestId}`
			);
			return;
		}

		clearTimeout(pending.timeout);
		this.pendingListRequests.delete(requestId);

		const networks = (msg as any).networks || [];
		pending.resolve(networks);
	}

	/**
	 * Handle server_list_response from irssi
	 */
	private handleServerListResponse(msg: FeWebMessage): void {
		const requestId = msg.response_to;
		if (!requestId) {
			log.warn("[IrssiClient] Received server_list_response without response_to");
			return;
		}

		const pending = this.pendingListRequests.get(requestId);
		if (!pending) {
			log.warn(
				`[IrssiClient] Received server_list_response for unknown request ${requestId}`
			);
			return;
		}

		clearTimeout(pending.timeout);
		this.pendingListRequests.delete(requestId);

		const servers = (msg as any).servers || [];
		pending.resolve(servers);
	}

	/**
	 * Send request to irssi and wait for command_result
	 */
	private async sendIrssiRequest(type: string, data: any): Promise<CommandResult> {
		if (!this.irssiConnection || !this.irssiConnection.isConnected()) {
			throw new Error("Not connected to irssi");
		}

		return new Promise((resolve, reject) => {
			const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(new Error(`Request timeout for ${type}`));
			}, 10000);

			this.pendingRequests.set(requestId, {resolve, reject, timeout});

			this.irssiConnection!.send({
				type,
				id: requestId,
				...data,
			});
		});
	}

	/**
	 * Send list request to irssi and wait for response
	 */
	private async sendIrssiListRequest(type: string, data: any = {}): Promise<any> {
		if (!this.irssiConnection || !this.irssiConnection.isConnected()) {
			throw new Error("Not connected to irssi");
		}

		return new Promise((resolve, reject) => {
			const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

			const timeout = setTimeout(() => {
				this.pendingListRequests.delete(requestId);
				reject(new Error(`Request timeout for ${type}`));
			}, 10000);

			this.pendingListRequests.set(requestId, {resolve, reject, timeout});

			this.irssiConnection!.send({
				type,
				id: requestId,
				...data,
			});
		});
	}

	/**
	 * List all IRC networks from irssi config
	 */
	async listIrssiNetworks(): Promise<IrssiNetwork[]> {
		log.info(`[IrssiClient] Listing networks for user ${this.name}`);
		const networks = await this.sendIrssiListRequest("network_list");
		return networks.map((net: any) => snakeToCamel(net));
	}

	/**
	 * List all servers (optionally filtered by network)
	 */
	async listIrssiServers(networkName?: string): Promise<IrssiServer[]> {
		log.info(
			`[IrssiClient] Listing servers for user ${this.name}${
				networkName ? ` (network: ${networkName})` : ""
			}`
		);
		const data = networkName ? {chatnet: networkName} : {};
		const servers = await this.sendIrssiListRequest("server_list", data);
		return servers.map((srv: any) => snakeToCamel(srv));
	}

	/**
	 * Add IRC network to irssi config
	 */
	async addIrssiNetwork(networkData: NetworkFormData): Promise<CommandResult> {
		log.info(`[IrssiClient] Adding network ${networkData.name} for user ${this.name}`);

		const irssiNetwork = networkFormToIrssi(networkData);

		const networkResult = await this.sendIrssiRequest("network_add", irssiNetwork);

		if (!networkResult.success) {
			return networkResult;
		}

		let successCount = 0;
		let failCount = 0;

		for (const server of networkData.servers) {
			const irssiServer = serverFormToIrssi(server, networkData.name);

			try {
				const serverResult = await this.sendIrssiRequest("server_add", irssiServer);

				if (serverResult.success) {
					successCount++;
				} else {
					failCount++;
					log.warn(
						`Failed to add server ${server.address}:${server.port}: ${serverResult.message}`
					);
				}
			} catch (error: any) {
				failCount++;
				log.error(`Error adding server ${server.address}:${server.port}: ${error.message}`);
			}
		}

		return {
			success: true,
			message: `Network '${
				networkData.name
			}' added successfully with ${successCount} server(s)${
				failCount > 0 ? ` (${failCount} failed)` : ""
			}`,
		};
	}

	/**
	 * Execute raw irssi command (for global commands like /CONNECT)
	 */
	executeIrssiCommand(command: string, server?: string): void {
		if (!this.irssiConnection) {
			throw new Error("Not connected to irssi");
		}

		this.irssiConnection.executeCommand(command, server);
		log.info(`[IrssiClient] Executed command: ${command}${server ? ` on ${server}` : ""}`);
	}

	/**
	 * Remove IRC network from irssi config
	 */
	async removeIrssiNetwork(name: string): Promise<CommandResult> {
		log.info(`[IrssiClient] Removing network ${name} for user ${this.name}`);
		return await this.sendIrssiRequest("network_remove", {name});
	}

	/**
	 * Add server to irssi config
	 */
	async addIrssiServer(serverData: ServerFormData, chatnet: string): Promise<CommandResult> {
		log.info(
			`[IrssiClient] Adding server ${serverData.address}:${serverData.port} to network ${chatnet} for user ${this.name}`
		);
		const irssiServer = serverFormToIrssi(serverData, chatnet);
		return await this.sendIrssiRequest("server_add", irssiServer);
	}

	/**
	 * Remove server from irssi config
	 */
	async removeIrssiServer(
		address: string,
		port: number,
		chatnet?: string
	): Promise<CommandResult> {
		log.info(
			`[IrssiClient] Removing server ${address}:${port}${
				chatnet ? ` from network ${chatnet}` : ""
			} for user ${this.name}`
		);
		const data: any = {address, port};
		if (chatnet) {
			data.chatnet = chatnet;
		}
		return await this.sendIrssiRequest("server_remove", data);
	}

	/**
	 * Start WeeChat Relay server for this user
	 */
	async startWeeChatRelay(): Promise<void> {
		log.info(`${colors.cyan("[WeeChat Relay]")} startWeeChatRelay() called for user ${colors.bold(this.name)}`);
		log.info(`${colors.cyan("[WeeChat Relay]")} Config:`, JSON.stringify(this.config.weechatRelay));

		if (!this.config.weechatRelay?.enabled) {
			log.info(`${colors.yellow("[WeeChat Relay]")} Not enabled for user ${colors.bold(this.name)}`);
			return;
		}

		if (this.weechatRelayServer) {
			log.warn(`WeeChat Relay already running for user ${colors.bold(this.name)}`);
			return;
		}

		// Decrypt WeeChat password
		if (!this.config.weechatRelay.passwordEncrypted) {
			log.warn(`User ${colors.bold(this.name)} has no WeeChat Relay password configured`);
			return;
		}

		log.info(`${colors.cyan("[WeeChat Relay]")} Decrypting password for user ${colors.bold(this.name)}`);

		const {decryptIrssiPassword} = await import("./irssiConfigHelper");
		this.weechatRelayPassword = await decryptIrssiPassword(
			this.config.weechatRelay.passwordEncrypted,
			"weechat-relay", // Use fixed salt for WeeChat password
			this.config.weechatRelay.port
		);

		log.info(`${colors.cyan("[WeeChat Relay]")} Password decrypted, length: ${this.weechatRelayPassword.length}`);

		// Import WeeChat Relay components
		log.info(`${colors.cyan("[WeeChat Relay]")} Importing WeeChat Relay components...`);
		const {WeeChatRelayServer} = await import("./weechatRelay/weechatRelayServer");
		const {ErssiToWeeChatAdapter} = await import("./weechatRelay/erssiToWeechatAdapter");
		const {WeeChatToErssiAdapter} = await import("./weechatRelay/weechatToErssiAdapter");

		// Create shared ErssiToWeeChatAdapter (one per user, shared by all Lith clients)
		if (!this.weechatErssiAdapter) {
			log.info(`${colors.cyan("[WeeChat Relay]")} Creating ErssiToWeeChatAdapter...`);
			this.weechatErssiAdapter = new ErssiToWeeChatAdapter(this);
		}

		// Create server
		log.info(`${colors.cyan("[WeeChat Relay]")} Creating WeeChatRelayServer on port ${this.config.weechatRelay.port}...`);
		this.weechatRelayServer = new WeeChatRelayServer({
			tcpPort: this.config.weechatRelay.port, // TCP for Lith
			tcpHost: "0.0.0.0", // Listen on all interfaces
			wsPort: undefined, // Disable WebSocket (use TCP only)
			wsHost: undefined,
			wsPath: "/weechat",
			password: this.weechatRelayPassword,
			passwordHashAlgo: ["plain", "sha256", "sha512", "pbkdf2+sha256", "pbkdf2+sha512"],
			passwordHashIterations: 100000,
			compression: this.config.weechatRelay.compression,
		});

		// Setup event handlers
		this.weechatRelayServer.on("client:authenticated", (clientId: string, username: string) => {
			log.info(
				`${colors.green("[WeeChat Relay]")} Client authenticated: ${clientId} for user ${this.name}`
			);

			// Get relay client
			const relayClient = this.weechatRelayServer.getClient(clientId);
			if (!relayClient) {
				log.error(`Relay client not found: ${clientId}`);
				return;
			}

			// Use shared ErssiToWeeChatAdapter (one per user, shared by all Lith clients)
			const erssiAdapter = this.weechatErssiAdapter;
			const weechatAdapter = new WeeChatToErssiAdapter(this, erssiAdapter, relayClient);

			// Connect erssiAdapter events to THIS relayClient
			erssiAdapter.on("line_data", (data: any) => {
				log.info(`${colors.cyan("[Erssi->WeeChat]")} Sending line_data to ${clientId}: ${data.message}`);

				// Send as TEXT protocol (not binary)
				// Format: (_buffer_line_added) hdata buffer/lines/line/line_data ...
				const msg = `(_buffer_line_added) _buffer_line_added buffer=${data.buffer} date=${data.date} prefix=${data.prefix} message=${data.message}\n`;

				relayClient.send(msg);
			});

			erssiAdapter.on("buffer:update", () => {
				log.info(`${colors.cyan("[Erssi->WeeChat]")} Buffer update for ${clientId}`);
				// Buffer updates are handled by hdata requests
			});

			// Store adapters on the relay client for cleanup
			(relayClient as any)._adapters = {erssiAdapter, weechatAdapter};
		});

		this.weechatRelayServer.on("client:close", (clientId: string) => {
			log.info(`${colors.yellow("[WeeChat Relay]")} Client closed: ${clientId}`);

			// Cleanup adapters
			const relayClient = this.weechatRelayServer.getClient(clientId);
			if (relayClient && (relayClient as any)._adapters) {
				const {erssiAdapter, weechatAdapter} = (relayClient as any)._adapters;
				erssiAdapter.removeAllListeners();
				weechatAdapter.removeAllListeners();
				delete (relayClient as any)._adapters;
			}
		});

		// Start server
		log.info(`${colors.cyan("[WeeChat Relay]")} Starting server...`);
		await this.weechatRelayServer.start();

		log.info(
			`${colors.green("[WeeChat Relay]")} ✅ Started for user ${colors.bold(this.name)} on port ${this.config.weechatRelay.port}`
		);
	}

	/**
	 * Stop WeeChat Relay server
	 */
	async stopWeeChatRelay(): Promise<void> {
		if (!this.weechatRelayServer) {
			return;
		}

		await this.weechatRelayServer.stop();
		this.weechatRelayServer = null;
		this.weechatRelayPassword = null;

		log.info(`${colors.yellow("[WeeChat Relay]")} Stopped for user ${colors.bold(this.name)}`);
	}
}

export default IrssiClient;
