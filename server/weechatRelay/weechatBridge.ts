/**
 * WeeChat Relay Bridge
 * 
 * Main bridge module that connects everything together:
 * - WeeChat Relay Server (accepts Lith connections)
 * - Erssi to WeeChat Adapter (translates erssi -> WeeChat)
 * - WeeChat to Erssi Adapter (translates WeeChat -> erssi)
 * - IrssiClient (connects to erssi fe-web)
 * 
 * Architecture:
 * 
 *   Lith Client
 *       |
 *       | WeeChat Relay Protocol (binary)
 *       v
 *   WeeChatRelayServer
 *       |
 *       | Commands/Events
 *       v
 *   WeeChatToErssiAdapter <---> ErssiToWeeChatAdapter
 *                                       |
 *                                       | erssi fe-web protocol (JSON)
 *                                       v
 *                                   IrssiClient
 *                                       |
 *                                       | WebSocket (encrypted)
 *                                       v
 *                                   erssi fe-web
 */

import {EventEmitter} from "events";
import log from "../log";
import colors from "chalk";
import {WeeChatRelayServer, WeeChatRelayServerConfig} from "./weechatRelayServer";
import {ErssiToWeeChatAdapter} from "./erssiToWeechatAdapter";
import {WeeChatToErssiAdapter} from "./weechatToErssiAdapter";
import {IrssiClient} from "../irssiClient";
import ClientManager from "../clientManager";

export interface WeeChatBridgeConfig {
	// WeeChat Relay server config
	relay: WeeChatRelayServerConfig;

	// Enable/disable bridge
	enabled: boolean;
}

/**
 * WeeChat Relay Bridge
 */
export class WeeChatBridge extends EventEmitter {
	private config: WeeChatBridgeConfig;
	private manager: ClientManager;
	private server: WeeChatRelayServer | null = null;
	private adapters: Map<string, {
		erssiAdapter: ErssiToWeeChatAdapter;
		weechatAdapter: WeeChatToErssiAdapter;
	}> = new Map();

	constructor(config: WeeChatBridgeConfig, manager: ClientManager) {
		super();
		this.config = config;
		this.manager = manager;
	}

	/**
	 * Start the bridge
	 */
	async start(): Promise<void> {
		if (!this.config.enabled) {
			log.info(`${colors.yellow("[WeeChat Bridge]")} Bridge disabled in config`);
			return;
		}

		log.info(`${colors.green("[WeeChat Bridge]")} Starting WeeChat Relay Bridge...`);

		// Create and start relay server
		this.server = new WeeChatRelayServer(this.config.relay);

		// Setup server event handlers
		this.server.on("client:authenticated", (clientId: string, username: string) => {
			this.handleClientAuthenticated(clientId, username);
		});

		this.server.on("client:close", (clientId: string) => {
			this.handleClientClose(clientId);
		});

		// Start server
		await this.server.start();

		log.info(`${colors.green("[WeeChat Bridge]")} WeeChat Relay Bridge started`);
	}

	/**
	 * Handle client authenticated
	 */
	private handleClientAuthenticated(clientId: string, username: string): void {
		log.info(
			`${colors.green("[WeeChat Bridge]")} Client authenticated: ${clientId} (user: ${username})`
		);

		// Find IrssiClient for this user
		const irssiClient = this.manager.clients.find(
			(c) => c instanceof IrssiClient && c.name === username
		) as IrssiClient | undefined;

		if (!irssiClient) {
			log.warn(
				`${colors.yellow("[WeeChat Bridge]")} No IrssiClient found for user: ${username}`
			);
			return;
		}

		// Get relay client
		const relayClient = this.server!.getClient(clientId);
		if (!relayClient) {
			log.error(
				`${colors.red("[WeeChat Bridge]")} Relay client not found: ${clientId}`
			);
			return;
		}

		// Create adapters
		const erssiAdapter = new ErssiToWeeChatAdapter(irssiClient);
		const weechatAdapter = new WeeChatToErssiAdapter(irssiClient, erssiAdapter, relayClient);

		this.adapters.set(clientId, {erssiAdapter, weechatAdapter});

		log.info(
			`${colors.green("[WeeChat Bridge]")} Adapters created for client: ${clientId}`
		);
	}

	/**
	 * Handle client close
	 */
	private handleClientClose(clientId: string): void {
		log.info(`${colors.yellow("[WeeChat Bridge]")} Client closed: ${clientId}`);

		// Clean up adapters
		const adapters = this.adapters.get(clientId);
		if (adapters) {
			adapters.erssiAdapter.removeAllListeners();
			adapters.weechatAdapter.removeAllListeners();
			this.adapters.delete(clientId);
		}
	}

	/**
	 * Stop the bridge
	 */
	async stop(): Promise<void> {
		if (!this.server) {
			return;
		}

		log.info(`${colors.yellow("[WeeChat Bridge]")} Stopping WeeChat Relay Bridge...`);

		// Clean up all adapters
		for (const [clientId, adapters] of this.adapters.entries()) {
			adapters.erssiAdapter.removeAllListeners();
			adapters.weechatAdapter.removeAllListeners();
		}
		this.adapters.clear();

		// Stop server
		await this.server.stop();
		this.server = null;

		log.info(`${colors.yellow("[WeeChat Bridge]")} WeeChat Relay Bridge stopped`);
	}

	/**
	 * Check if bridge is running
	 */
	isRunning(): boolean {
		return this.server !== null;
	}
}

