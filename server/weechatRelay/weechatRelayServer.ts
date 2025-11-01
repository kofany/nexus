/**
 * WeeChat Relay Bridge Server
 * 
 * This server emulates a WeeChat Relay server, allowing clients like Lith
 * to connect to nexuslounge backend (which connects to erssi fe-web).
 * 
 * Architecture:
 * - Lith client connects via WebSocket/TCP
 * - This bridge translates WeeChat Relay protocol <-> erssi fe-web protocol
 * - Uses existing IrssiClient for actual IRC connection
 * 
 * Protocol flow:
 * 1. Client connects
 * 2. Client sends: handshake (optional, for auth negotiation)
 * 3. Client sends: init (authentication)
 * 4. Server sends: initial state (buffers, lines, nicklist)
 * 5. Client sends: sync (subscribe to updates)
 * 6. Bidirectional: messages, commands, updates
 */

import {Server as NetServer, Socket as NetSocket} from "net";
import {Server as WebSocketServer, WebSocket} from "ws";
import {EventEmitter} from "events";
import log from "../log";
import colors from "chalk";
import {WeeChatMessage, WeeChatParser} from "./weechatProtocol";
import {WeeChatRelayClient} from "./weechatRelayClient";

export interface WeeChatRelayServerConfig {
	// TCP port for plain connections
	tcpPort?: number;
	tcpHost?: string;

	// WebSocket port
	wsPort?: number;
	wsHost?: string;
	wsPath?: string;

	// Authentication
	password?: string;
	passwordHashAlgo?: string[];
	passwordHashIterations?: number;

	// Compression
	compression?: boolean;
}

/**
 * WeeChat Relay Bridge Server
 */
export class WeeChatRelayServer extends EventEmitter {
	private config: WeeChatRelayServerConfig;
	private tcpServer: NetServer | null = null;
	private wsServer: WebSocketServer | null = null;
	private clients: Map<string, WeeChatRelayClient> = new Map();
	private clientIdCounter = 0;

	constructor(config: WeeChatRelayServerConfig) {
		super();
		this.config = {
			tcpPort: 9001,
			tcpHost: "127.0.0.1",
			wsPort: 9002,
			wsHost: "127.0.0.1",
			wsPath: "/weechat",
			password: "",
			passwordHashAlgo: ["plain", "sha256", "sha512", "pbkdf2+sha256", "pbkdf2+sha512"],
			passwordHashIterations: 100000,
			compression: true,
			...config,
		};
	}

	/**
	 * Start the server
	 */
	async start(): Promise<void> {
		// Start TCP server
		if (this.config.tcpPort) {
			await this.startTcpServer();
		}

		// Start WebSocket server
		if (this.config.wsPort) {
			await this.startWebSocketServer();
		}

		log.info(
			`${colors.green("[WeeChat Relay Bridge]")} Server started - ` +
			`TCP: ${this.config.tcpHost}:${this.config.tcpPort}, ` +
			`WS: ${this.config.wsHost}:${this.config.wsPort}${this.config.wsPath}`
		);
	}

	/**
	 * Start TCP server
	 */
	private async startTcpServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.tcpServer = new NetServer();

			this.tcpServer.on("connection", (socket: NetSocket) => {
				this.handleTcpConnection(socket);
			});

			this.tcpServer.on("error", (err) => {
				log.error(`${colors.red("[WeeChat Relay Bridge]")} TCP server error: ${err}`);
				reject(err);
			});

			this.tcpServer.listen(this.config.tcpPort, this.config.tcpHost, () => {
				log.info(
					`${colors.green("[WeeChat Relay Bridge]")} TCP server listening on ` +
					`${this.config.tcpHost}:${this.config.tcpPort}`
				);
				resolve();
			});
		});
	}

	/**
	 * Start WebSocket server
	 */
	private async startWebSocketServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.wsServer = new WebSocketServer({
				host: this.config.wsHost,
				port: this.config.wsPort,
				path: this.config.wsPath,
			});

			this.wsServer.on("connection", (ws: WebSocket) => {
				this.handleWebSocketConnection(ws);
			});

			this.wsServer.on("error", (err) => {
				log.error(`${colors.red("[WeeChat Relay Bridge]")} WebSocket server error: ${err}`);
				reject(err);
			});

			this.wsServer.on("listening", () => {
				log.info(
					`${colors.green("[WeeChat Relay Bridge]")} WebSocket server listening on ` +
					`${this.config.wsHost}:${this.config.wsPort}${this.config.wsPath}`
				);
				resolve();
			});
		});
	}

	/**
	 * Handle TCP connection
	 */
	private handleTcpConnection(socket: NetSocket): void {
		const clientId = `tcp-${this.clientIdCounter++}`;
		const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;

		log.info(
			`${colors.green("[WeeChat Relay Bridge]")} New TCP connection: ${clientId} from ${remoteAddr}`
		);

		const client = new WeeChatRelayClient(clientId, socket, this.config);
		this.clients.set(clientId, client);

		// Forward events
		client.on("authenticated", (user) => {
			this.emit("client:authenticated", clientId, user);
		});

		client.on("command", (command, args) => {
			this.emit("client:command", clientId, command, args);
		});

		client.on("close", () => {
			log.info(`${colors.yellow("[WeeChat Relay Bridge]")} TCP connection closed: ${clientId}`);
			this.clients.delete(clientId);
			this.emit("client:close", clientId);
		});

		client.on("error", (err) => {
			log.error(`${colors.red("[WeeChat Relay Bridge]")} TCP client error: ${clientId} - ${err}`);
		});
	}

	/**
	 * Handle WebSocket connection
	 */
	private handleWebSocketConnection(ws: WebSocket): void {
		const clientId = `ws-${this.clientIdCounter++}`;

		log.info(
			`${colors.green("[WeeChat Relay Bridge]")} New WebSocket connection: ${clientId}`
		);

		const client = new WeeChatRelayClient(clientId, ws, this.config);
		this.clients.set(clientId, client);

		// Forward events
		client.on("authenticated", (user) => {
			this.emit("client:authenticated", clientId, user);
		});

		client.on("command", (command, args) => {
			this.emit("client:command", clientId, command, args);
		});

		client.on("close", () => {
			log.info(`${colors.yellow("[WeeChat Relay Bridge]")} WebSocket connection closed: ${clientId}`);
			this.clients.delete(clientId);
			this.emit("client:close", clientId);
		});

		client.on("error", (err) => {
			log.error(`${colors.red("[WeeChat Relay Bridge]")} WebSocket client error: ${clientId} - ${err}`);
		});
	}

	/**
	 * Get client by ID
	 */
	getClient(clientId: string): WeeChatRelayClient | undefined {
		return this.clients.get(clientId);
	}

	/**
	 * Get all clients
	 */
	getClients(): WeeChatRelayClient[] {
		return Array.from(this.clients.values());
	}

	/**
	 * Stop the server
	 */
	async stop(): Promise<void> {
		// Close all clients
		for (const client of this.clients.values()) {
			client.close();
		}
		this.clients.clear();

		// Close TCP server
		if (this.tcpServer) {
			await new Promise<void>((resolve) => {
				this.tcpServer!.close(() => resolve());
			});
			this.tcpServer = null;
		}

		// Close WebSocket server
		if (this.wsServer) {
			await new Promise<void>((resolve) => {
				this.wsServer!.close(() => resolve());
			});
			this.wsServer = null;
		}

		log.info(`${colors.yellow("[WeeChat Relay Bridge]")} Server stopped`);
	}
}
