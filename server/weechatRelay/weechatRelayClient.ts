/**
 * WeeChat Relay Client Handler
 * 
 * Handles a single client connection (TCP or WebSocket).
 * Manages authentication, command parsing, and message sending.
 */

import {EventEmitter} from "events";
import {Socket as NetSocket} from "net";
import {WebSocket} from "ws";
import log from "../log";
import colors from "chalk";
import {WeeChatMessage, WeeChatParser, OBJ_HASHTABLE, OBJ_STRING} from "./weechatProtocol";
import {WeeChatRelayServerConfig} from "./weechatRelayServer";
import crypto from "crypto";

type ClientSocket = NetSocket | WebSocket;

enum ClientStatus {
	CONNECTING = "connecting",
	AUTHENTICATING = "authenticating",
	CONNECTED = "connected",
	DISCONNECTED = "disconnected",
}

/**
 * WeeChat Relay Client
 */
export class WeeChatRelayClient extends EventEmitter {
	private id: string;
	private socket: ClientSocket;
	private config: WeeChatRelayServerConfig;
	private status: ClientStatus = ClientStatus.CONNECTING;
	private authenticated: boolean = false;
	private handshakeDone: boolean = false;
	private passwordHashAlgo: string = "plain";
	private nonce: string = "";
	private compression: boolean = false;
	private username: string = "";
	private buffer: Buffer = Buffer.alloc(0);

	constructor(id: string, socket: ClientSocket, config: WeeChatRelayServerConfig) {
		super();
		this.id = id;
		this.socket = socket;
		this.config = config;

		this.setupSocket();
		this.status = ClientStatus.AUTHENTICATING;
	}

	/**
	 * Setup socket event handlers
	 */
	private setupSocket(): void {
		if (this.socket instanceof WebSocket) {
			// WebSocket
			this.socket.on("message", (data: Buffer) => {
				this.handleData(data);
			});

			this.socket.on("close", () => {
				this.handleClose();
			});

			this.socket.on("error", (err) => {
				this.emit("error", err);
			});
		} else {
			// TCP Socket
			this.socket.on("data", (data: Buffer) => {
				this.handleData(data);
			});

			this.socket.on("close", () => {
				this.handleClose();
			});

			this.socket.on("error", (err) => {
				this.emit("error", err);
			});
		}
	}

	/**
	 * Handle incoming data
	 */
	private handleData(data: Buffer): void {
		log.info(`${colors.cyan("[WeeChat Relay Client]")} Received data from ${this.id}, length: ${data.length}`);

		// Append to buffer
		this.buffer = Buffer.concat([this.buffer, data]);

		// Try to parse messages
		while (this.buffer.length >= 5) {
			// Read message length (first 4 bytes, big endian)
			const messageLength = this.buffer.readUInt32BE(0);

			log.info(`${colors.cyan("[WeeChat Relay Client]")} Message length: ${messageLength}, buffer length: ${this.buffer.length}`);

			// Check if we have the full message
			if (this.buffer.length < messageLength) {
				log.info(`${colors.yellow("[WeeChat Relay Client]")} Waiting for more data...`);
				break; // Wait for more data
			}

			// Extract message
			const messageData = this.buffer.slice(0, messageLength);
			this.buffer = this.buffer.slice(messageLength);

			// Parse and handle message
			try {
				this.handleMessage(messageData);
			} catch (err) {
				log.error(
					`${colors.red("[WeeChat Relay Client]")} Error parsing message from ${this.id}: ${err}`
				);
				this.emit("error", err);
			}
		}
	}

	/**
	 * Handle parsed message
	 */
	private handleMessage(data: Buffer): void {
		log.info(`${colors.cyan("[WeeChat Relay Client]")} Parsing message from ${this.id}, data length: ${data.length}`);

		const parser = new WeeChatParser(data);

		// Read message ID
		const messageId = parser.readString() || "";

		log.info(
			`${colors.cyan("[WeeChat Relay Client]")} Message from ${this.id}: ${messageId}`
		);

		// Parse command (format: "(id) command args" or "command args")
		let command = "";
		let commandId = "";
		let args = "";

		if (messageId.startsWith("(") && messageId.includes(")")) {
			// Has ID: "(id) command args"
			const closeParen = messageId.indexOf(")");
			commandId = messageId.substring(1, closeParen);
			const rest = messageId.substring(closeParen + 1).trim();
			const spaceIdx = rest.indexOf(" ");
			if (spaceIdx > 0) {
				command = rest.substring(0, spaceIdx);
				args = rest.substring(spaceIdx + 1);
			} else {
				command = rest;
			}
		} else {
			// No ID: "command args"
			const spaceIdx = messageId.indexOf(" ");
			if (spaceIdx > 0) {
				command = messageId.substring(0, spaceIdx);
				args = messageId.substring(spaceIdx + 1);
			} else {
				command = messageId;
			}
		}

		log.info(`${colors.cyan("[WeeChat Relay Client]")} Parsed command: "${command}", id: "${commandId}", args: "${args}"`);

		// Handle command
		switch (command.toLowerCase()) {
			case "handshake":
				this.handleHandshake(commandId, args);
				break;
			case "init":
				this.handleInit(commandId, args);
				break;
			case "hdata":
				this.handleHData(commandId, args);
				break;
			case "info":
				this.handleInfo(commandId, args);
				break;
			case "infolist":
				this.handleInfoList(commandId, args);
				break;
			case "nicklist":
				this.handleNicklist(commandId, args);
				break;
			case "input":
				this.handleInput(commandId, args);
				break;
			case "completion":
				this.handleCompletion(commandId, args);
				break;
			case "sync":
				this.handleSync(commandId, args);
				break;
			case "desync":
				this.handleDesync(commandId, args);
				break;
			case "test":
				this.handleTest(commandId, args);
				break;
			case "ping":
				this.handlePing(commandId, args);
				break;
			case "quit":
				this.handleQuit(commandId, args);
				break;
			default:
				log.warn(
					`${colors.yellow("[WeeChat Relay Client]")} Unknown command from ${this.id}: ${command}`
				);
		}
	}

	/**
	 * Handle handshake command
	 */
	private handleHandshake(id: string, args: string): void {
		log.info(`${colors.green("[WeeChat Relay Client]")} Handshake from ${this.id}: ${args}`);

		// Parse options (format: "key=value,key=value")
		const options: Record<string, string> = {};
		if (args) {
			const pairs = args.split(",");
			for (const pair of pairs) {
				const [key, value] = pair.split("=");
				if (key && value) {
					options[key.trim()] = value.trim();
				}
			}
		}

		// Check password_hash_algo
		let selectedAlgo = "plain";
		if (options.password_hash_algo) {
			const requestedAlgos = options.password_hash_algo.split(":");
			const supportedAlgos = this.config.passwordHashAlgo || ["plain"];

			// Find best match (prefer stronger algorithms)
			for (const algo of ["pbkdf2+sha512", "pbkdf2+sha256", "sha512", "sha256", "plain"]) {
				if (requestedAlgos.includes(algo) && supportedAlgos.includes(algo)) {
					selectedAlgo = algo;
					break;
				}
			}
		}

		this.passwordHashAlgo = selectedAlgo;

		// Check compression
		if (options.compression) {
			const requestedComp = options.compression.split(",");
			if (requestedComp.includes("zlib") && this.config.compression) {
				this.compression = true;
			}
		}

		// Generate nonce for authentication
		this.nonce = crypto.randomBytes(16).toString("hex");

		// Send handshake response
		const msg = new WeeChatMessage(id || "handshake");
		msg.addType(OBJ_HASHTABLE);
		msg.addHashtable({
			password_hash_algo: selectedAlgo,
			password_hash_iterations: (this.config.passwordHashIterations || 100000).toString(),
			compression: this.compression ? "zlib" : "off",
			nonce: this.nonce,
		});

		this.send(msg);
		this.handshakeDone = true;
	}

	/**
	 * Handle init command (authentication)
	 */
	private handleInit(id: string, args: string): void {
		log.info(`${colors.green("[WeeChat Relay Client]")} Init from ${this.id}, args: ${args}`);

		// Parse options
		const options: Record<string, string> = {};
		if (args) {
			const pairs = args.split(",");
			for (const pair of pairs) {
				const [key, value] = pair.split("=");
				if (key && value) {
					options[key.trim()] = value.trim();
				}
			}
		}

		log.info(`${colors.cyan("[WeeChat Relay Client]")} Parsed options: ${JSON.stringify(options)}`);

		// Check password
		let passwordOk = false;
		const expectedPassword = this.config.password || "";

		log.info(`${colors.cyan("[WeeChat Relay Client]")} Expected password length: ${expectedPassword.length}`);

		if (options.password) {
			// Plain text password
			log.info(`${colors.cyan("[WeeChat Relay Client]")} Using plain text password`);
			passwordOk = options.password === expectedPassword;
			log.info(`${colors.cyan("[WeeChat Relay Client]")} Password match: ${passwordOk}`);
		} else if (options.password_hash) {
			// Hashed password
			log.info(`${colors.cyan("[WeeChat Relay Client]")} Using hashed password: ${options.password_hash}`);
			passwordOk = this.verifyPasswordHash(options.password_hash, expectedPassword);
			log.info(`${colors.cyan("[WeeChat Relay Client]")} Hash verification: ${passwordOk}`);
		} else {
			log.warn(`${colors.yellow("[WeeChat Relay Client]")} No password or password_hash provided!`);
		}

		if (passwordOk) {
			this.authenticated = true;
			this.status = ClientStatus.CONNECTED;

			// Extract username from options if provided, otherwise use default
			this.username = options.username || options.user || "default";

			log.info(`${colors.green("[WeeChat Relay Client]")} Client ${this.id} authenticated as ${this.username}`);
			this.emit("authenticated", this.username);
		} else {
			log.warn(`${colors.yellow("[WeeChat Relay Client]")} Client ${this.id} authentication failed`);
			this.close();
		}
	}

	/**
	 * Verify password hash
	 */
	private verifyPasswordHash(hash: string, expectedPassword: string): boolean {
		// Format: "algo:salt:hash" or "algo:params:salt:iterations:hash"
		const parts = hash.split(":");

		if (parts.length < 2) {
			return false;
		}

		const algo = parts[0];

		try {
			if (algo === "sha256" || algo === "sha512") {
				// Format: "sha256:salt:hash"
				const salt = parts[1];
				const receivedHash = parts[2];

				const computed = crypto
					.createHash(algo)
					.update(Buffer.from(salt, "hex"))
					.update(expectedPassword)
					.digest("hex");

				return computed === receivedHash;
			} else if (algo === "pbkdf2") {
				// Format: "pbkdf2:sha256:salt:iterations:hash"
				const hashAlgo = parts[1];
				const salt = parts[2];
				const iterations = parseInt(parts[3], 10);
				const receivedHash = parts[4];

				const computed = crypto
					.pbkdf2Sync(
						expectedPassword,
						Buffer.from(salt, "hex"),
						iterations,
						hashAlgo === "sha512" ? 64 : 32,
						hashAlgo
					)
					.toString("hex");

				return computed === receivedHash;
			}
		} catch (err) {
			log.error(`${colors.red("[WeeChat Relay Client]")} Error verifying password: ${err}`);
		}

		return false;
	}

	/**
	 * Handle other commands (to be implemented by adapter)
	 */
	private handleHData(id: string, args: string): void {
		this.emit("command", "hdata", {id, args});
	}

	private handleInfo(id: string, args: string): void {
		this.emit("command", "info", {id, args});
	}

	private handleInfoList(id: string, args: string): void {
		this.emit("command", "infolist", {id, args});
	}

	private handleNicklist(id: string, args: string): void {
		this.emit("command", "nicklist", {id, args});
	}

	private handleInput(id: string, args: string): void {
		this.emit("command", "input", {id, args});
	}

	private handleCompletion(id: string, args: string): void {
		this.emit("command", "completion", {id, args});
	}

	private handleSync(id: string, args: string): void {
		this.emit("command", "sync", {id, args});
	}

	private handleDesync(id: string, args: string): void {
		this.emit("command", "desync", {id, args});
	}

	private handleTest(id: string, args: string): void {
		this.emit("command", "test", {id, args});
	}

	private handlePing(id: string, args: string): void {
		// Send pong
		const msg = new WeeChatMessage("_pong");
		msg.addType(OBJ_STRING);
		msg.addString(args || "");
		this.send(msg);
	}

	private handleQuit(id: string, args: string): void {
		this.close();
	}

	/**
	 * Send message to client
	 */
	send(msg: WeeChatMessage): void {
		const data = msg.build(this.compression);

		if (this.socket instanceof WebSocket) {
			this.socket.send(data);
		} else {
			this.socket.write(data);
		}
	}

	/**
	 * Handle close
	 */
	private handleClose(): void {
		this.status = ClientStatus.DISCONNECTED;
		this.emit("close");
	}

	/**
	 * Close connection
	 */
	close(): void {
		if (this.socket instanceof WebSocket) {
			this.socket.close();
		} else {
			this.socket.end();
		}
	}

	/**
	 * Get client ID
	 */
	getId(): string {
		return this.id;
	}

	/**
	 * Check if authenticated
	 */
	isAuthenticated(): boolean {
		return this.authenticated;
	}

	/**
	 * Get username
	 */
	getUsername(): string {
		return this.username;
	}
}

