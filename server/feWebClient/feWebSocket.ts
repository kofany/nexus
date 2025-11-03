/**
 * fe-web WebSocket Client (Server-side)
 *
 * RFC 6455 compliant WebSocket client for irssi fe-web module.
 * Implements the protocol specified in CLIENT-SPEC.md
 *
 * This is a server-side port of client/js/feWebSocket.ts using Node.js 'ws' library.
 */

import WebSocket from "ws";
import {EventEmitter} from "events";
import {FeWebEncryption} from "./feWebEncryption";
import log from "../log";

// Message types from CLIENT-SPEC.md
export interface FeWebMessage {
	id?: string;
	type: string;
	timestamp?: number;
	server?: string;
	server_tag?: string; // Server tag (for activity_update, mark_read)
	channel?: string;
	target?: string; // Channel/query name (for activity_update, mark_read)
	nick?: string;
	text?: string;
	level?: number; // Activity level (for activity_update): 0=NONE, 1=TEXT, 2=MSG, 3=HILIGHT
	is_own?: boolean;
	is_highlight?: boolean; // Message is a highlight (mentions user's nick)
	response_to?: string;
	extra?: Record<string, any>;
	command?: string;
	task?: string; // For nicklist_update: "add", "remove", "change", "+o", "-o", "+v", "-v", "+h", "-h"
	// Network/Server management fields
	success?: boolean; // For command_result
	message?: string; // For command_result
	error_code?: string; // For command_result
	networks?: any[]; // For network_list_response
	servers?: any[]; // For server_list_response
}

// Client → Server message types
export type ClientMessageType =
	| "sync_server"
	| "command"
	| "ping"
	| "close_query"
	| "mark_read"
	| "network_list"
	| "server_list"
	| "network_add"
	| "network_remove"
	| "server_add"
	| "server_remove";

// Server → Client message types
export type ServerMessageType =
	| "auth_ok"
	| "message"
	| "server_status"
	| "channel_join"
	| "channel_part"
	| "channel_kick"
	| "user_quit"
	| "topic"
	| "channel_mode"
	| "nicklist"
	| "nicklist_update" // Delta update for nicklist (NEW!)
	| "nick_change"
	| "user_mode"
	| "away"
	| "whois"
	| "channel_list"
	| "state_dump"
	| "query_opened"
	| "query_closed"
	| "activity_update" // Activity level changed (unread markers)
	| "mark_read" // Channel marked as read (from irssi window change)
	| "error"
	| "pong"
	| "network_list_response"
	| "server_list_response"
	| "command_result";

export interface FeWebConfig {
	host: string;
	port: number;
	password?: string; // WebSocket authentication password (used for key derivation)
	encryption?: boolean; // Use AES-256-GCM encryption (ALWAYS true for fe-web v1.5)

	// SSL/TLS options (fe-web v1.5 REQUIRES wss://)
	useTLS?: boolean; // Use wss:// instead of ws:// (default: true for fe-web v1.5)
	rejectUnauthorized?: boolean; // Verify SSL certificate (false for self-signed)
	ca?: Buffer; // CA certificate for self-signed cert verification
	cert?: Buffer; // Client certificate (optional)
	key?: Buffer; // Client key (optional)

	autoConnect?: boolean;
	defaultServer?: string;
	reconnect?: boolean;
	reconnectDelay?: number;
	maxReconnectDelay?: number;
	pingInterval?: number;

	// Callback for disconnect event (for IrssiClient reconnect handling)
	onDisconnect?: (code: number, reason: string) => void;
}

type MessageHandler = (message: FeWebMessage) => void;

// Internal config type with all required fields
type InternalFeWebConfig = Required<Omit<FeWebConfig, "ca" | "cert" | "key" | "onDisconnect">> & {
	ca?: Buffer;
	cert?: Buffer;
	key?: Buffer;
	onDisconnect?: (code: number, reason: string) => void;
};

export class FeWebSocket extends EventEmitter {
	private config: InternalFeWebConfig;
	private ws: WebSocket | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private pingIntervalTimer: NodeJS.Timeout | null = null;
	private currentReconnectDelay: number;
	private messageHandlers: Map<ServerMessageType, MessageHandler[]> = new Map();
	private _isConnected = false;
	private isAuthenticated = false;
	private messageIdCounter = 0;
	private encryption: FeWebEncryption | null = null;

	/**
	 * Check if WebSocket is connected
	 */
	public isConnected(): boolean {
		return this._isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	constructor(config: FeWebConfig) {
		super(); // Call EventEmitter constructor
		this.config = {
			host: config.host,
			port: config.port,
			password: config.password ?? "",
			encryption: config.encryption ?? true, // ALWAYS true for fe-web v1.5

			// SSL/TLS options (fe-web v1.5 REQUIRES wss://)
			useTLS: config.useTLS ?? true, // Default to wss:// for fe-web v1.5
			rejectUnauthorized: config.rejectUnauthorized ?? false, // Accept self-signed by default
			ca: config.ca,
			cert: config.cert,
			key: config.key,

			autoConnect: config.autoConnect ?? true,
			defaultServer: config.defaultServer ?? "*",
			reconnect: config.reconnect ?? true,
			reconnectDelay: config.reconnectDelay ?? 1000,
			maxReconnectDelay: config.maxReconnectDelay ?? 30000,
			pingInterval: config.pingInterval ?? 30000, // 30s as per CLIENT-SPEC.md
		};

		this.currentReconnectDelay = this.config.reconnectDelay;

		// Initialize encryption (REQUIRED for fe-web v1.5)
		if (this.config.encryption && this.config.password) {
			this.encryption = new FeWebEncryption(
				this.config.password, // WebSocket password (for PBKDF2 with FIXED salt)
				true
			);
		}
	}

	/**
	 * Get connection status
	 */
	get connected(): boolean {
		return this._isConnected && this.isAuthenticated;
	}

	/**
	 * Connect to fe-web WebSocket server (v1.5 with dual-layer security)
	 */
	async connect(): Promise<void> {
		// Derive encryption key if encryption is enabled (REQUIRED for fe-web v1.5)
		if (this.encryption) {
			log.debug("[FeWebSocket] Deriving encryption key (fe-web v1.5)...");
			await this.encryption.deriveKey();
		}

		return new Promise((resolve, reject) => {
			// fe-web v1.5 REQUIRES wss:// (dual-layer security)
			const protocol = this.config.useTLS ? "wss" : "ws";
			let url = `${protocol}://${this.config.host}:${this.config.port}/`;

			// Add password as query parameter if provided
			if (this.config.password && this.config.password.length > 0) {
				url += `?password=${encodeURIComponent(this.config.password)}`;
			}

			const encStatus = this.encryption ? "AES-256-GCM" : "plain";
			const tlsStatus = this.config.useTLS ? "TLS" : "plain";
			log.debug(
				`[FeWebSocket] Connecting to ${url} (Layer 1: ${tlsStatus}, Layer 2: ${encStatus})...`
			);

			// Prepare WebSocket options for SSL/TLS
			const wsOptions: any = {};

			if (this.config.useTLS) {
				// SSL/TLS options for self-signed certificates
				if (this.config.rejectUnauthorized !== undefined) {
					wsOptions.rejectUnauthorized = this.config.rejectUnauthorized;
				}
				if (this.config.ca) {
					wsOptions.ca = this.config.ca;
				}
				if (this.config.cert) {
					wsOptions.cert = this.config.cert;
				}
				if (this.config.key) {
					wsOptions.key = this.config.key;
				}

				// irssi with OpenSSL 3.x requires TLS 1.2+
				// Node.js 24 also defaults to TLS 1.2+
				wsOptions.minVersion = "TLSv1.2";
				wsOptions.maxVersion = "TLSv1.3";

				log.debug(
					`[FeWebSocket] SSL/TLS options: rejectUnauthorized=${wsOptions.rejectUnauthorized}, minVersion=TLSv1.2, maxVersion=TLSv1.3`
				);
			}

			try {
				// WebSocket constructor: new WebSocket(address, protocols, options)
				// protocols: string | string[] | undefined
				// options: object (TLS options go here!)
				this.ws = new WebSocket(url, undefined, wsOptions);
			} catch (error) {
				log.error(`[FeWebSocket] Failed to create WebSocket: ${error}`);
				reject(error);
				return;
			}

			// Register auth handler BEFORE opening connection (use .once() to ensure it runs only once)
			this.once("auth_ok", (msg: FeWebMessage) => {
				log.debug("[FeWebSocket] authHandler called (ONCE), msg.type:", msg.type);
				log.debug("[FeWebSocket] Authenticated - resolving promise");
				this.isAuthenticated = true;
				clearTimeout(authTimeout);

				// Start keepalive ping
				this.startPing();

				// Auto sync to default server
				if (this.config.defaultServer) {
					this.syncServer(this.config.defaultServer);
				}

				log.debug("[FeWebSocket] Calling resolve()");
				resolve();
				log.debug("[FeWebSocket] resolve() called");
			});

			// Timeout if no auth_ok received
			const authTimeout = setTimeout(() => {
				if (!this.isAuthenticated) {
					reject(new Error("Authentication timeout - no auth_ok received from server"));
				}
			}, 10000); // 10 seconds

			// Connection opened
			this.ws.on("open", () => {
				log.debug("[FeWebSocket] WebSocket connected, waiting for auth_ok...");
				this._isConnected = true;
				this.currentReconnectDelay = this.config.reconnectDelay;
			});

			// Message received
			this.ws.on("message", (data: WebSocket.Data) => {
				this.handleMessage(data);
			});

			// Connection error
			this.ws.on("error", (error: Error) => {
				log.error(`[FeWebSocket] WebSocket error: ${error.message}`);
				reject(error);
			});

			// Connection closed
			this.ws.on("close", (code: number, reason: Buffer) => {
				const reasonStr = reason.toString();
				log.debug(`[FeWebSocket] WebSocket closed (code: ${code}, reason: ${reasonStr})`);
				this._isConnected = false;
				this.isAuthenticated = false;
				this.stopPing();

				// Emit 'disconnected' event for EventEmitter listeners
				this.emit("disconnected", code, reasonStr);

				// Notify parent (IrssiClient) about disconnect
				if (this.config.onDisconnect) {
					this.config.onDisconnect(code, reasonStr);
				}

				// Check for authentication failure (HTTP 401 → WebSocket close code 1002)
				if (code === 1002) {
					const authError = new Error(
						"Authentication failed - invalid or missing password"
					);
					log.error("[FeWebSocket]", authError.message);
					reject(authError);
					return; // Don't attempt reconnection on auth failure
				}

				// Attempt reconnection if enabled
				if (this.config.reconnect) {
					this.scheduleReconnect();
				}
			});
		});
	}

	/**
	 * Disconnect from fe-web server
	 */
	disconnect(): void {
		log.debug("[FeWebSocket] Disconnecting...");
		this.config.reconnect = false; // Disable auto-reconnect

		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.stopPing();

		if (this.ws) {
			this.ws.close(1000, "Client disconnect");
			this.ws = null;
		}

		this._isConnected = false;
		this.isAuthenticated = false;
	}

	/**
	 * Send a message to fe-web server
	 */
	send(message: FeWebMessage): void {
		// Call async version but don't wait
		this.sendAsync(message).catch((error) => {
			log.error("[FeWebSocket] Failed to send message:", error);
		});
	}

	/**
	 * Send a message to fe-web server (async version)
	 */
	private async sendAsync(message: FeWebMessage): Promise<void> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			log.error("[FeWebSocket] Cannot send message: not connected");
			return;
		}

		// Add message ID if not present
		if (!message.id && message.type !== "pong") {
			message.id = this.generateMessageId();
		}

		const json = JSON.stringify(message);
		log.debug("[FeWebSocket] Sending:", json);

		try {
			if (this.encryption) {
				// Encrypt and send as binary frame
				const encrypted = await this.encryption.encrypt(json);
				this.ws.send(encrypted);
			} else {
				// Send as text frame (plain)
				this.ws.send(json);
			}
		} catch (error) {
			log.error(`[FeWebSocket] Encryption failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Register a message handler for a specific message type
	 * Note: Use onMessage() instead of on() to avoid conflict with EventEmitter
	 */
	onMessage(type: ServerMessageType, handler: MessageHandler): void {
		if (!this.messageHandlers.has(type)) {
			this.messageHandlers.set(type, []);
		}

		this.messageHandlers.get(type)!.push(handler);
	}

	/**
	 * Unregister a message handler
	 * Note: Use offMessage() instead of off() to avoid conflict with EventEmitter
	 */
	offMessage(type: ServerMessageType, handler: MessageHandler): void {
		const handlers = this.messageHandlers.get(type);

		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index !== -1) {
				handlers.splice(index, 1);
			}
		}
	}

	/**
	 * Sync with IRC server (CLIENT-SPEC.md: sync_server)
	 */
	syncServer(serverTag: string): void {
		this.send({
			type: "sync_server",
			server: serverTag,
		});
	}

	/**
	 * Execute IRC command (CLIENT-SPEC.md: command)
	 *
	 * IMPORTANT: Commands sent via WebSocket API MUST have "/" prefix!
	 * The irssi command system (src/core/commands.c) checks if the first character
	 * is a cmdchar (default: "/"). If not, it treats the input as regular text
	 * and sends it via "send text" signal instead of executing as a command.
	 *
	 * This method automatically adds "/" prefix if not present.
	 */
	executeCommand(command: string, server?: string): void {
		// Ensure command starts with /
		if (!command.startsWith("/")) {
			command = "/" + command;
		}

		log.debug(
			`[FeWebSocket] Executing command: ${command}`,
			server ? `on server: ${server}` : ""
		);

		const msg: any = {
			type: "command",
			command: command,
		};

		// Add server tag if provided
		if (server) {
			msg.server = server;
		}

		this.send(msg);
	}

	/**
	 * Send keepalive ping (CLIENT-SPEC.md: ping)
	 */
	ping(): void {
		this.send({
			type: "ping",
			id: `ping-${Date.now()}`,
		});
	}

	/**
	 * Close query window (CLIENT-SPEC.md: close_query)
	 */
	closeQuery(server: string, nick: string): void {
		log.debug(`[FeWebSocket] Closing query: ${nick} on ${server}`);
		this.send({
			type: "close_query",
			server: server,
			nick: nick,
		});
	}

	/**
	 * Check if connected and authenticated
	 */
	isReady(): boolean {
		return this._isConnected && this.isAuthenticated;
	}

	/**
	 * Handle incoming WebSocket message
	 */
	private async handleMessage(data: WebSocket.Data): Promise<void> {
		try {
			log.debug(
				`[FeWebSocket] Received message, type: ${
					Buffer.isBuffer(data) ? "binary" : typeof data
				}, length: ${Buffer.isBuffer(data) ? data.length : (data as string).length}`
			);

			let json: string;

			// Check if message is binary (encrypted) or text (plain)
			if (Buffer.isBuffer(data)) {
				// Binary frame - decrypt
				if (!this.encryption) {
					log.error(
						"[FeWebSocket] Received encrypted message but encryption is disabled"
					);
					return;
				}

				log.debug(`[FeWebSocket] Decrypting binary message (${data.length} bytes)...`);
				json = await this.encryption.decrypt(data);
				log.debug(`[FeWebSocket] Decrypted message: ${json}`);
			} else if (typeof data === "string") {
				// Text frame - plain JSON
				json = data;
				log.debug(`[FeWebSocket] Plain text message: ${json}`);
			} else {
				log.error("[FeWebSocket] Unexpected message type:", typeof data);
				return;
			}

			const message: FeWebMessage = JSON.parse(json);
			log.debug(`[FeWebSocket] Received: ${JSON.stringify(message)}`);

			// Emit event for EventEmitter listeners (used in connect() Promise)
			this.emit(message.type, message);

			// Dispatch to registered handlers
			const handlers = this.messageHandlers.get(message.type as ServerMessageType);

			if (handlers) {
				log.debug(
					`[FeWebSocket] Calling ${handlers.length} handler(s) for type: ${message.type}`
				);
				handlers.forEach((handler) => {
					try {
						handler(message);
					} catch (error) {
						log.error(`[FeWebSocket] Error in handler for ${message.type}: ${error}`);
					}
				});
			} else {
				log.warn(`[FeWebSocket] No handlers registered for message type: ${message.type}`);
			}
		} catch (error) {
			log.error(`[FeWebSocket] Failed to parse message: ${error}`);
		}
	}

	/**
	 * Start keepalive ping interval
	 */
	private startPing(): void {
		this.stopPing();

		this.pingIntervalTimer = setInterval(() => {
			if (this._isConnected) {
				this.ping();
			}
		}, this.config.pingInterval);
	}

	/**
	 * Stop keepalive ping interval
	 */
	private stopPing(): void {
		if (this.pingIntervalTimer !== null) {
			clearInterval(this.pingIntervalTimer);
			this.pingIntervalTimer = null;
		}
	}

	/**
	 * Schedule reconnection with exponential backoff
	 */
	private scheduleReconnect(): void {
		if (this.reconnectTimer !== null) {
			return; // Already scheduled
		}

		log.debug(`[FeWebSocket] Reconnecting in ${this.currentReconnectDelay}ms...`);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;

			this.connect().catch((error) => {
				log.error("[FeWebSocket] Reconnection failed:", error);

				// Exponential backoff
				this.currentReconnectDelay = Math.min(
					this.currentReconnectDelay * 2,
					this.config.maxReconnectDelay
				);
			});
		}, this.currentReconnectDelay);
	}

	/**
	 * Generate unique message ID
	 */
	private generateMessageId(): string {
		return `msg-${Date.now()}-${++this.messageIdCounter}`;
	}
}
