import client from "prom-client";
import type ClientManager from "../clientManager.js";

// Create a Registry
export const register = new client.Registry();

// Default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({register});

// Custom metrics
export const metrics = {
	// Messages processed
	messagesTotal: new client.Counter({
		name: "nexusirc_messages_total",
		help: "Total messages processed",
		labelNames: ["type", "network"],
		registers: [register],
	}),

	// Active connections
	activeConnections: new client.Gauge({
		name: "nexusirc_connections_active",
		help: "Number of active WebSocket connections",
		registers: [register],
	}),

	// Active users
	activeUsers: new client.Gauge({
		name: "nexusirc_users_active",
		help: "Number of active users",
		registers: [register],
	}),

	// Irssi connection status
	irssiConnected: new client.Gauge({
		name: "nexusirc_irssi_connected",
		help: "Irssi connection status (1=connected, 0=disconnected)",
		labelNames: ["user"],
		registers: [register],
	}),

	// Message storage latency
	storageLatency: new client.Histogram({
		name: "nexusirc_storage_latency_seconds",
		help: "Message storage operation duration",
		buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
		registers: [register],
	}),

	// WeeChat Relay connections
	weechatConnections: new client.Gauge({
		name: "nexusirc_weechat_connections",
		help: "Number of WeeChat Relay connections",
		labelNames: ["user"],
		registers: [register],
	}),
};

// Update functions
export function updateMetrics(manager: ClientManager) {
	metrics.activeUsers.set(manager.clients.length);

	// Socket.IO v4: io.sockets.sockets is a Map<string, Socket>
	const socketsMap = manager.sockets?.sockets as any;
	const totalConnections = socketsMap?.size || 0;
	metrics.activeConnections.set(totalConnections);

	manager.clients.forEach((irssiClient) => {
		const isConnected = irssiClient.irssiConnection?.isConnected() ? 1 : 0;
		metrics.irssiConnected.set({user: irssiClient.name}, isConnected);

		// TODO: Add getConnectionCount() method to WeeChatRelayServer
		// const weechatConns = irssiClient.weechatRelayServer?.getConnectionCount() || 0;
		// metrics.weechatConnections.set({user: irssiClient.name}, weechatConns);
	});
}
