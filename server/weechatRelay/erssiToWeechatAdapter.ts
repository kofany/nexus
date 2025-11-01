/**
 * Erssi to WeeChat Adapter
 * 
 * Translates erssi fe-web messages to WeeChat Relay protocol.
 * 
 * Key mappings:
 * - erssi network -> WeeChat buffer (type: server)
 * - erssi channel -> WeeChat buffer (type: channel)
 * - erssi query -> WeeChat buffer (type: private)
 * - erssi message -> WeeChat line_data
 * - erssi user -> WeeChat nick
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
import {ChanType} from "../../shared/types/chan";

/**
 * Buffer representation (WeeChat concept)
 */
interface WeeChatBuffer {
	pointer: bigint;
	number: number;
	fullName: string;
	shortName: string;
	type: string; // "server", "channel", "private"
	title: string;
	localVariables: Record<string, string>;
	networkUuid: string;
	channelId: number;
}

/**
 * Erssi to WeeChat Adapter
 */
export class ErssiToWeeChatAdapter extends EventEmitter {
	private irssiClient: IrssiClient;
	private buffers: Map<string, WeeChatBuffer> = new Map(); // key: network.uuid + ":" + channel.id
	private bufferPointers: Map<bigint, string> = new Map(); // reverse lookup
	private bufferCounter = 1;

	constructor(irssiClient: IrssiClient) {
		super();
		this.irssiClient = irssiClient;
		this.initializeBuffers();
		// Note: We don't use event listeners here because IrssiClient doesn't extend EventEmitter
		// Instead, IrssiClient.handleMessage() calls handleNewMessage() directly
	}

	/**
	 * Handle new message from IrssiClient
	 */
	public handleNewMessage(network: NetworkData, channel: Chan, msg: Msg): void {
		const buffer = this.getOrCreateBuffer(network, channel);

		log.info(`${colors.cyan("[Erssi->WeeChat]")} Emitting line_data for buffer ${buffer.pointer}`);

		// Emit line_data event for WeeChat clients
		this.emit("line_data", {
			buffer: buffer.pointer,
			date: Math.floor(msg.time.getTime() / 1000),
			prefix: msg.from?.nick || "",
			message: msg.text,
			highlight: msg.highlight || false,
			self: msg.self || false,
		});
	}

	/**
	 * Initialize buffers from existing networks/channels
	 */
	private initializeBuffers(): void {
		// Create buffers for all existing networks and channels
		for (const network of this.irssiClient.networks) {
			// Create server buffer
			this.getOrCreateBuffer(network);

			// Create channel buffers
			for (const channel of network.channels) {
				this.getOrCreateBuffer(network, channel);
			}
		}
	}

	/**
	 * Get or create buffer for network/channel
	 */
	private getOrCreateBuffer(network: NetworkData, channel?: Chan): WeeChatBuffer {
		const key = channel ? `${network.uuid}:${channel.id}` : `${network.uuid}:0`;

		let buffer = this.buffers.get(key);
		if (!buffer) {
			const pointer = generatePointer();
			const number = this.bufferCounter++;

			if (channel) {
				// Channel or query buffer
				const isChannel = channel.type === ChanType.CHANNEL;
				buffer = {
					pointer,
					number,
					fullName: `${network.name}.${channel.name}`,
					shortName: channel.name,
					type: isChannel ? "channel" : "private",
					title: channel.topic || "",
					localVariables: {
						type: isChannel ? "channel" : "private",
						server: network.name,
						channel: channel.name,
						nick: network.nick || "",
					},
					networkUuid: network.uuid,
					channelId: channel.id,
				};
			} else {
				// Server buffer
				buffer = {
					pointer,
					number,
					fullName: network.name,
					shortName: network.name,
					type: "server",
					title: network.serverTag || network.name,
					localVariables: {
						type: "server",
						server: network.name,
						nick: network.nick || "",
					},
					networkUuid: network.uuid,
					channelId: 0,
				};
			}

			this.buffers.set(key, buffer);
			this.bufferPointers.set(pointer, key);
		}

		return buffer;
	}

	/**
	 * Build buffers HData (for initial sync)
	 */
	buildBuffersHData(id: string): WeeChatMessage {
		const msg = new WeeChatMessage(id);

		const fields: HDataField[] = [
			{name: "id", type: "ptr"},
			{name: "number", type: "int"},
			{name: "full_name", type: "str"},
			{name: "short_name", type: "str"},
			{name: "type", type: "int"}, // 0=formatted, 1=free
			{name: "nicklist", type: "int"}, // 0=no, 1=yes
			{name: "title", type: "str"},
			{name: "local_variables", type: "str"}, // Simplified: comma-separated key=value
			{name: "prev_buffer", type: "ptr"},
			{name: "next_buffer", type: "ptr"},
		];

		const objects: HDataObject[] = [];
		const bufferList = Array.from(this.buffers.values()).sort((a, b) => a.number - b.number);

		for (let i = 0; i < bufferList.length; i++) {
			const buffer = bufferList[i];
			const prevPtr = i > 0 ? bufferList[i - 1].pointer : 0n;
			const nextPtr = i < bufferList.length - 1 ? bufferList[i + 1].pointer : 0n;

			// Convert local_variables to string
			const localVarsStr = Object.entries(buffer.localVariables)
				.map(([k, v]) => `${k}=${v}`)
				.join(",");

			objects.push({
				pointers: [buffer.pointer],
				values: {
					id: buffer.pointer,
					number: buffer.number,
					full_name: buffer.fullName,
					short_name: buffer.shortName,
					type: 0, // formatted
					nicklist: buffer.type === "channel" ? 1 : 0,
					title: buffer.title,
					local_variables: localVarsStr,
					prev_buffer: prevPtr,
					next_buffer: nextPtr,
				},
			});
		}

		if (objects.length > 0) {
			buildHData(msg, "buffer", fields, objects);
		} else {
			buildEmptyHData(msg);
		}

		return msg;
	}

	/**
	 * Build lines HData (for history)
	 */
	buildLinesHData(id: string, bufferPtr: bigint, count: number = 100): WeeChatMessage {
		const msg = new WeeChatMessage(id);

		// Find buffer
		const bufferKey = this.bufferPointers.get(bufferPtr);
		if (!bufferKey) {
			buildEmptyHData(msg);
			return msg;
		}

		const buffer = this.buffers.get(bufferKey);
		if (!buffer) {
			buildEmptyHData(msg);
			return msg;
		}

		// Get channel
		const network = this.irssiClient.networks.find((n) => n.uuid === buffer.networkUuid);
		if (!network) {
			buildEmptyHData(msg);
			return msg;
		}

		const channel = network.channels.find((c) => c.id === buffer.channelId);
		if (!channel) {
			buildEmptyHData(msg);
			return msg;
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
		const messages = channel.messages.slice(-count);

		for (const m of messages) {
			const linePtr = generatePointer();
			const timestamp = Math.floor(m.time.getTime() / 1000);

			objects.push({
				pointers: [linePtr],
				values: {
					buffer: buffer.pointer,
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
	 * Get all buffers
	 */
	getBuffers(): WeeChatBuffer[] {
		return Array.from(this.buffers.values());
	}

	/**
	 * Get buffer by pointer
	 */
	getBuffer(pointer: bigint): WeeChatBuffer | undefined {
		const key = this.bufferPointers.get(pointer);
		return key ? this.buffers.get(key) : undefined;
	}
}

