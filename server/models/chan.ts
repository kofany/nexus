import _ from "lodash";
import log from "../log.js";
import Config from "../config.js";
import User from "./user.js";
import Msg from "./msg.js";
import storage from "../plugins/storage.js";
// LEGACY: Client class removed (SINGLE MODE uses IrssiClient only)
// import Client from "../client.js";
import Network from "./network.js";
import Prefix from "./prefix.js";
import {MessageType, SharedMsg} from "../../shared/types/msg.js";
import {ChanType, SpecialChanType, ChanState} from "../../shared/types/chan.js";
import {SharedNetworkChan} from "../../shared/types/network.js";

export type ChanConfig = {
	name: string;
	key?: string;
	muted?: boolean;
	type?: string;
};

class Chan {
	// TODO: don't force existence, figure out how to make TS infer it.
	id!: number;
	messages!: Msg[];
	name!: string;
	key!: string;
	topic!: string;
	firstUnread!: number;
	unread!: number;
	highlight!: number;
	users!: Map<string, User>;
	muted!: boolean;
	type!: ChanType;
	state!: ChanState;

	userAway?: boolean;
	special?: SpecialChanType;
	data?: any;
	closed?: boolean;
	num_users?: number;
	totalMessagesInStorage?: number; // Total count from storage (irssi mode)

	constructor(attr?: Partial<Chan>) {
		_.defaults(this, attr, {
			id: 0,
			messages: [],
			name: "",
			key: "",
			topic: "",
			type: ChanType.CHANNEL,
			state: ChanState.PARTED,
			firstUnread: 0,
			unread: 0,
			highlight: 0,
			users: new Map(),
			muted: false,
		});
	}

	destroy() {
		this.dereferencePreviews(this.messages);
	}

	pushMessage(client: any, msg: Msg, increasesUnread = false) {
		const chanId = this.id;
		msg.id = client.idMsg++;

		// If this channel is open in any of the clients, do not increase unread counter
		const isOpen = _.find(client.attachedClients, {openChannel: chanId}) !== undefined;

		if (msg.self) {
			// reset counters/markers when receiving self-/echo-message
			this.unread = 0;
			this.firstUnread = msg.id;
			this.highlight = 0;
		} else if (!isOpen) {
			if (!this.firstUnread) {
				this.firstUnread = msg.id;
			}

			if (increasesUnread || msg.highlight) {
				this.unread++;
			}

			if (msg.highlight) {
				this.highlight++;
			}
		}

		client.emit("msg", {chan: chanId, msg, unread: this.unread, highlight: this.highlight});

		// showInActive is only processed on "msg", don't need it on page reload
		if (msg.showInActive) {
			delete msg.showInActive;
		}

		this.writeUserLog(client, msg);

		if (Config.values.maxHistory >= 0 && this.messages.length > Config.values.maxHistory) {
			const deleted = this.messages.splice(
				0,
				this.messages.length - Config.values.maxHistory
			);

			// If maxHistory is 0, image would be dereferenced before client had a chance to retrieve it,
			// so for now, just don't implement dereferencing for this edge case.
			if (Config.values.maxHistory > 0) {
				this.dereferencePreviews(deleted);
			}
		}
	}

	dereferencePreviews(messages: Msg[]) {
		if (!Config.values.prefetch || !Config.values.prefetchStorage) {
			return;
		}

		messages.forEach((message) => {
			if (message.previews) {
				message.previews.forEach((preview) => {
					if (preview.thumb) {
						storage.dereference(preview.thumb);
						preview.thumb = "";
					}
				});
			}
		});
	}

	getSortedUsers() {
		const users = Array.from(this.users.values());

		// Simple alphabetical sort by nick (proxy mode)
		return users.sort(function (a, b) {
			if (a.mode === b.mode) {
				return a.nick.toLowerCase() < b.nick.toLowerCase() ? -1 : 1;
			}

			// Sort by mode priority: @ > + > (no mode)
			const modePriority = {"@": 0, "+": 1, "": 2};
			const aPriority = modePriority[a.mode] ?? 2;
			const bPriority = modePriority[b.mode] ?? 2;
			return aPriority - bPriority;
		});
	}

	findMessage(msgId: number) {
		return this.messages.find((message) => message.id === msgId);
	}

	findUser(nick: string) {
		return this.users.get(nick.toLowerCase());
	}

	getUser(nick: string) {
		return this.findUser(nick) || new User({nick}, new Prefix([]));
	}

	setUser(user: User) {
		this.users.set(user.nick.toLowerCase(), user);
	}

	removeUser(user: User) {
		this.users.delete(user.nick.toLowerCase());
	}

	/**
	 * Get a clean clone of this channel that will be sent to the client.
	 * This function performs manual cloning of channel object for
	 * better control of performance and memory usage.
	 *
	 * @param {(int|bool)} lastActiveChannel - Last known active user channel id (needed to control how many messages are sent)
	 *                                         If true, channel is assumed active.
	 * @param {int} lastMessage - Last message id seen by active client to avoid sending duplicates.
	 */
	getFilteredClone(
		lastActiveChannel?: number | boolean,
		lastMessage?: number
	): SharedNetworkChan {
		let msgs: SharedMsg[];

		// If client is reconnecting, only send new messages that client has not seen yet
		if (lastMessage && lastMessage > -1) {
			// When reconnecting, always send up to 100 messages to prevent message gaps on the client
			// See https://github.com/thelounge/thelounge/issues/1883
			msgs = this.messages.filter((m) => m.id > lastMessage).slice(-100);
		} else {
			// If channel is active, send up to 100 last messages, for all others send just 1
			// Client will automatically load more messages whenever needed based on last seen messages
			const messagesToSend =
				lastActiveChannel === true || this.id === lastActiveChannel ? 100 : 1;
			msgs = this.messages.slice(-messagesToSend);
		}

		return {
			id: this.id,
			messages: msgs,
			totalMessages: this.totalMessagesInStorage ?? this.messages.length,
			name: this.name,
			key: this.key,
			topic: this.topic,
			firstUnread: this.firstUnread,
			unread: this.unread,
			highlight: this.highlight,
			muted: this.muted,
			type: this.type,
			state: this.state,

			special: this.special,
			data: this.data,
			closed: this.closed,
			num_users: this.num_users,
			users: Array.from(this.users.values()), // Include users array for irssi mode
		};
		// TODO: funny array mutation below might need to be reproduced
		// static optionalProperties = ["userAway", "special", "data", "closed", "num_users"];
		// return Object.keys(this).reduce((newChannel, prop) => {
		// 	if (Chan.optionalProperties.includes(prop)) {
		// 		if (this[prop] !== undefined || (Array.isArray(this[prop]) && this[prop].length)) {
		// 			newChannel[prop] = this[prop];
		// 		}
		// 	}
	}

	writeUserLog(client: any, msg: Msg) {
		this.messages.push(msg);

		// Are there any logs enabled
		if (client.messageStorage.length === 0) {
			return;
		}

		const targetChannel: Chan = this;

		// Is this particular message or channel loggable
		if (!msg.isLoggable() || !this.isLoggable()) {
			// Because notices are nasty and can be shown in active channel on the client
			// if there is no open query, we want to always log notices in the sender's name
			if (msg.type === MessageType.NOTICE && msg.showInActive) {
				targetChannel.name = msg.from.nick || ""; // TODO: check if || works
			} else {
				return;
			}
		}

		// Find the parent network where this channel is in
		const target = client.find(this.id);

		if (!target) {
			return;
		}

		for (const messageStorage of client.messageStorage) {
			messageStorage.index(target.network, targetChannel, msg).catch((e) => log.error(e));
		}
	}

	loadMessages(client: any, network: Network) {
		if (!this.isLoggable()) {
			return;
		}

		if (!client.messageProvider) {
			// In proxy mode, message history is handled by messageProvider
			return;
		}

		client.messageProvider
			.getMessages(network, this, () => client.idMsg++)
			.then((messages) => {
				if (messages.length === 0) {
					return;
				}

				this.messages.unshift(...messages);

				if (!this.firstUnread) {
					this.firstUnread = messages[messages.length - 1].id;
				}

				client.emit("more", {
					chan: this.id,
					messages: messages.slice(-100),
					totalMessages: messages.length,
				});
			})
			.catch((err: Error) =>
				log.error(`Failed to load messages for ${client.name}: ${err.toString()}`)
			);
	}

	isLoggable() {
		return this.type === ChanType.CHANNEL || this.type === ChanType.QUERY;
	}

	setMuteStatus(muted: boolean) {
		this.muted = !!muted;
	}
}

export default Chan;

export type Channel = Chan;
