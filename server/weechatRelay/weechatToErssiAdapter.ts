/**
 * WeeChat to Erssi Adapter
 * 
 * Translates WeeChat Relay commands to erssi fe-web commands.
 * 
 * Key command mappings:
 * - hdata buffer:gui_buffers(*) -> Send buffer list
 * - hdata buffer:0xXXX/lines/last_line(-N)/data -> Send message history
 * - input 0xXXX /command -> Send IRC command
 * - input 0xXXX message -> Send IRC message
 * - sync * buffer,nicklist -> Subscribe to updates
 */

import {EventEmitter} from "events";
import log from "../log";
import colors from "chalk";
import {WeeChatMessage, OBJ_STRING, OBJ_HDATA} from "./weechatProtocol";
import {buildEmptyHData, stringToPointer} from "./weechatHData";
import {IrssiClient} from "../irssiClient";
import {ErssiToWeeChatAdapter} from "./erssiToWeechatAdapter";
import {WeeChatRelayClient} from "./weechatRelayClient";

/**
 * WeeChat to Erssi Adapter
 */
export class WeeChatToErssiAdapter extends EventEmitter {
	private irssiClient: IrssiClient;
	private erssiAdapter: ErssiToWeeChatAdapter;
	private relayClient: WeeChatRelayClient;
	private syncedBuffers: Set<bigint> = new Set();
	private syncAll: boolean = false;

	constructor(
		irssiClient: IrssiClient,
		erssiAdapter: ErssiToWeeChatAdapter,
		relayClient: WeeChatRelayClient
	) {
		super();
		this.irssiClient = irssiClient;
		this.erssiAdapter = erssiAdapter;
		this.relayClient = relayClient;

		this.setupRelayHandlers();
		this.setupErssiAdapterHandlers();
	}

	/**
	 * Setup handlers for relay client commands
	 */
	private setupRelayHandlers(): void {
		this.relayClient.on("command", (data: {command: string; id: string; args: string}) => {
			log.info(`${colors.cyan("[WeeChatToErssiAdapter]")} Received command: ${data.command}, id: ${data.id}`);

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
				case "test":
					this.handleTest(data.id, data.args);
					break;
			}
		});
	}

	/**
	 * Setup handlers for erssi adapter events (to forward to client)
	 */
	private setupErssiAdapterHandlers(): void {
		this.erssiAdapter.on("buffer:opened", (buffer: any) => {
			if (this.syncAll || this.syncedBuffers.has(buffer.pointer)) {
				this.sendBufferOpened(buffer);
			}
		});

		this.erssiAdapter.on("buffer:closed", (buffer: any) => {
			if (this.syncAll || this.syncedBuffers.has(buffer.pointer)) {
				this.sendBufferClosed(buffer);
			}
		});

		this.erssiAdapter.on("line:added", (buffer: any, msg: any) => {
			log.info(`${colors.cyan("[WeeChatToErssiAdapter]")} line:added event: buffer=${buffer.pointer}, syncAll=${this.syncAll}, synced=${this.syncedBuffers.has(buffer.pointer)}`);
			if (this.syncAll || this.syncedBuffers.has(buffer.pointer)) {
				this.sendLineAdded(buffer, msg);
			} else {
				log.warn(`${colors.yellow("[WeeChatToErssiAdapter]")} ❌ NOT sending line (syncAll=false, buffer not synced)`);
			}
		});

		this.erssiAdapter.on("nicklist:changed", (buffer: any, users: any) => {
			if (this.syncAll || this.syncedBuffers.has(buffer.pointer)) {
				this.sendNicklistChanged(buffer, users);
			}
		});
	}

	/**
	 * Handle hdata command
	 */
	private handleHData(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} HData request: ${args}`);

		// Parse hdata request
		// Format: "buffer:gui_buffers(*) id,number,name,..."
		// or: "buffer:0x12345/lines/last_line(-100)/data date,prefix,message,..."

		const spaceIdx = args.indexOf(" ");
		const path = spaceIdx > 0 ? args.substring(0, spaceIdx) : args;
		const keys = spaceIdx > 0 ? args.substring(spaceIdx + 1) : "";

		if (path.startsWith("buffer:gui_buffers")) {
			// Request all buffers
			const msg = this.erssiAdapter.buildBuffersHData(id);
			this.relayClient.send(msg);
		} else if (path.includes("/lines/")) {
			// Request message history
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

				const msg = this.erssiAdapter.buildLinesHData(id, bufferPtr, count);
				this.relayClient.send(msg);
			} else {
				// Invalid buffer pointer
				const msg = new WeeChatMessage(id);
				buildEmptyHData(msg);
				this.relayClient.send(msg);
			}
		} else {
			// Unknown hdata request
			log.warn(`${colors.yellow("[WeeChat->Erssi]")} Unknown hdata request: ${path}`);
			const msg = new WeeChatMessage(id);
			buildEmptyHData(msg);
			this.relayClient.send(msg);
		}
	}

	/**
	 * Handle info command
	 */
	private handleInfo(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Info request: ${args}`);

		const msg = new WeeChatMessage(id);
		msg.addType(OBJ_STRING);

		// Handle common info requests
		if (args === "version") {
			msg.addString("4.4.2"); // Pretend to be WeeChat 4.4.2
		} else {
			msg.addString(null);
		}

		this.relayClient.send(msg);
	}

	/**
	 * Handle infolist command
	 */
	private handleInfoList(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} InfoList request: ${args}`);

		// For now, return empty infolist
		const msg = new WeeChatMessage(id);
		buildEmptyHData(msg);
		this.relayClient.send(msg);
	}

	/**
	 * Handle nicklist command
	 */
	private handleNicklist(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Nicklist request: ${args}`);

		// Parse buffer pointer
		const match = args.match(/0x([0-9a-f]+)/i);
		if (!match) {
			const msg = new WeeChatMessage(id);
			buildEmptyHData(msg);
			this.relayClient.send(msg);
			return;
		}

		const bufferPtr = BigInt("0x" + match[1]);
		const buffer = this.erssiAdapter.getBuffer(bufferPtr);

		if (!buffer) {
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

		// Build nicklist HData
		const msg = new WeeChatMessage(id);
		msg.addType(OBJ_HDATA);

		// h-path: "nicklist_item"
		msg.addString("nicklist_item");

		// keys: "group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str"
		msg.addString("group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str");

		// Build nicklist items
		const users = channel.users || new Map();
		const userArray = Array.from(users.values());
		msg.addInt(userArray.length);

		for (const user of userArray) {
			// Add pointer (generate unique for each user)
			const userPtr = stringToPointer(`${buffer.pointer}-${user.nick}`);
			msg.addPointer(userPtr);

			// group: 0 = user, 1 = group
			msg.addChar(0);

			// visible: 1 = visible
			msg.addChar(1);

			// level: user level (0 = normal)
			msg.addInt(0);

			// name: nick
			msg.addString(user.nick);

			// color: default
			msg.addString("default");

			// prefix: mode prefix (@, +, etc.)
			// user.mode is already a symbol (e.g. "@", "+", "%")
			// modes array contains symbols: ["@"], ["+"], etc.
			const prefix = user.mode || ""; // First mode symbol
			msg.addString(prefix);

			// prefix_color: color for prefix
			const prefixColor = prefix === "@" ? "lightgreen" :
			                   prefix === "+" ? "yellow" :
			                   prefix === "%" ? "cyan" :
			                   prefix === "~" ? "lightred" :
			                   prefix === "&" ? "lightmagenta" : "default";
			msg.addString(prefixColor);
		}

		this.relayClient.send(msg);
	}

	/**
	 * Handle input command (send message or command)
	 */
	private handleInput(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Input: ${args}`);

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
		const buffer = this.erssiAdapter.getBuffer(bufferPtr);

		if (!buffer) {
			log.warn(`${colors.yellow("[WeeChat->Erssi]")} Buffer not found: ${bufferPtrStr}`);
			return;
		}

		// Find network and channel
		const network = this.irssiClient.networks.find((n) => n.uuid === buffer.networkUuid);
		if (!network) {
			log.warn(`${colors.yellow("[WeeChat->Erssi]")} Network not found: ${buffer.networkUuid}`);
			return;
		}

		const channel = network.channels.find((c) => c.id === buffer.channelId);
		if (!channel) {
			log.warn(`${colors.yellow("[WeeChat->Erssi]")} Channel not found: ${buffer.channelId}`);
			return;
		}

		// Send to erssi
		this.irssiClient.handleInput(this.relayClient.getId(), {
			target: channel.id,
			text: text,
		});
	}

	/**
	 * Handle sync command (subscribe to updates)
	 */
	private handleSync(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Sync: "${args}"`);

		// Empty args or "*" = sync all buffers
		if (!args || args.trim() === "" || args.trim() === "*") {
			this.syncAll = true;
			log.info(`${colors.green("[WeeChat->Erssi]")} ✅ Syncing ALL buffers (syncAll=true)`);
			return;
		}

		// Parse: "* buffer,nicklist" or "0x12345 buffer"
		const parts = args.split(" ");
		const target = parts[0];
		const flags = parts.length > 1 ? parts[1].split(",") : [];

		if (target === "*") {
			// Sync all buffers
			this.syncAll = true;
			log.info(`${colors.green("[WeeChat->Erssi]")} ✅ Syncing ALL buffers (syncAll=true)`);
		} else {
			// Sync specific buffer
			const match = target.match(/0x([0-9a-f]+)/i);
			if (match) {
				const bufferPtr = BigInt("0x" + match[1]);
				this.syncedBuffers.add(bufferPtr);
				log.info(`${colors.green("[WeeChat->Erssi]")} ✅ Syncing buffer: ${target}`);
			}
		}
	}

	/**
	 * Handle desync command (unsubscribe from updates)
	 */
	private handleDesync(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Desync: ${args}`);

		// Parse: "* buffer,nicklist" or "0x12345 buffer"
		const parts = args.split(" ");
		const target = parts[0];

		if (target === "*") {
			// Desync all buffers
			this.syncAll = false;
			this.syncedBuffers.clear();
			log.info(`${colors.yellow("[WeeChat->Erssi]")} Desynced all buffers`);
		} else {
			// Desync specific buffer
			const match = target.match(/0x([0-9a-f]+)/i);
			if (match) {
				const bufferPtr = BigInt("0x" + match[1]);
				this.syncedBuffers.delete(bufferPtr);
				log.info(`${colors.yellow("[WeeChat->Erssi]")} Desynced buffer: ${target}`);
			}
		}
	}

	/**
	 * Handle test command
	 */
	private handleTest(id: string, args: string): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Test command - not needed with real erssi`);
		// We don't need test data, we have real erssi connection
		const msg = new WeeChatMessage(id);
		msg.addType(OBJ_STRING);
		msg.addString("OK");
		this.relayClient.send(msg);
	}

	/**
	 * Send buffer opened event
	 */
	private sendBufferOpened(buffer: any): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Sending buffer opened: ${buffer.fullName}`);

		const msg = new WeeChatMessage("_buffer_opened");
		msg.addType(OBJ_HDATA);
		msg.addString("buffer");
		msg.addString("id:ptr,number:int,full_name:str,short_name:str,type:int,nicklist:int,title:str,local_variables:str,prev_buffer:ptr,next_buffer:ptr");
		msg.addInt(1);

		msg.addPointer(buffer.pointer);
		msg.addPointer(buffer.pointer);
		msg.addInt(buffer.number);
		msg.addString(buffer.fullName);
		msg.addString(buffer.shortName);
		msg.addInt(0);
		msg.addInt(buffer.type === "channel" ? 1 : 0);
		msg.addString(buffer.title);

		const localVarsStr = Object.entries(buffer.localVariables)
			.map(([k, v]) => `${k}=${v}`)
			.join(",");
		msg.addString(localVarsStr);
		msg.addPointer(0n);
		msg.addPointer(0n);

		this.relayClient.send(msg);
	}

	/**
	 * Send buffer closed event
	 */
	private sendBufferClosed(buffer: any): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Sending buffer closed: ${buffer.fullName}`);

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
	 * Send line added event
	 */
	private sendLineAdded(buffer: any, message: any): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Sending line added: ${buffer.fullName}`);

		const msg = new WeeChatMessage("_buffer_line_added");
		msg.addType(OBJ_HDATA);
		msg.addString("line_data");
		msg.addString("buffer:ptr,id:ptr,date:tim,date_usec:int,date_printed:tim,date_usec_printed:int,displayed:chr,notify_level:int,highlight:chr,tags_array:arr:str,prefix:str,message:str");
		msg.addInt(1);

		const linePtr = stringToPointer(`${buffer.pointer}-${message.id || Date.now()}`);
		msg.addPointer(linePtr);
		msg.addPointer(buffer.pointer);
		msg.addPointer(linePtr);

		const timestamp = Math.floor((message.time?.getTime() || Date.now()) / 1000);
		msg.addTime(timestamp);
		msg.addInt(0);
		msg.addTime(timestamp);
		msg.addInt(0);
		msg.addChar(1);
		msg.addInt(message.highlight ? 3 : 1);
		msg.addChar(message.highlight ? 1 : 0);

		const tags: string[] = [];
		if (message.type === "message") tags.push("irc_privmsg");
		else if (message.type === "action") tags.push("irc_action");
		else if (message.type === "notice") tags.push("irc_notice");
		else if (message.type === "join") tags.push("irc_join");
		else if (message.type === "part") tags.push("irc_part");
		else if (message.type === "quit") tags.push("irc_quit");
		else if (message.type === "nick") tags.push("irc_nick");

		if (message.from?.nick) tags.push(`nick_${message.from.nick}`);
		if (message.self) tags.push("self_msg");

		msg.addArray("str", tags);
		msg.addString(message.from?.nick || "");
		msg.addString(message.text || "");

		this.relayClient.send(msg);
	}

	/**
	 * Send nicklist changed event
	 */
	private sendNicklistChanged(buffer: any, users: Map<string, any>): void {
		log.debug(`${colors.cyan("[WeeChat->Erssi]")} Sending nicklist changed: ${buffer.fullName}`);

		const msg = new WeeChatMessage("_nicklist_diff");
		msg.addType(OBJ_HDATA);
		msg.addString("nicklist_item");
		msg.addString("buffer:ptr,_diff:chr,group:chr,visible:chr,level:int,name:str,color:str,prefix:str,prefix_color:str");

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
}

