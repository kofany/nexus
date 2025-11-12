import _ from "lodash";
import {v4 as uuidv4} from "uuid";
import Chan, {ChanConfig, Channel} from "./chan.js";
import Msg from "./msg.js";
import Prefix from "./prefix.js";
import Helper, {Hostmask} from "../helper.js";
import Config from "../config.js";
import STSPolicies from "../plugins/sts.js";
import {MessageType} from "../../shared/types/msg.js";
import {ChanType} from "../../shared/types/chan.js";
import {SharedNetwork} from "../../shared/types/network.js";

type NetworkStatus = {
	connected: boolean;
	secure: boolean;
};

export type IgnoreListItem = Hostmask & {
	when: number;
};

type IgnoreList = IgnoreListItem[];

export type NetworkConfig = {
	nick: string;
	name: string;
	host: string;
	port: number;
	tls: boolean;
	userDisconnected: boolean;
	rejectUnauthorized: boolean;
	password: string;
	awayMessage: string;
	commands: any[];
	username: string;
	realname: string;
	leaveMessage: string;
	sasl: string;
	saslAccount: string;
	saslPassword: string;
	channels: ChanConfig[];
	uuid: string;
	proxyHost: string;
	proxyPort: number;
	proxyUsername: string;
	proxyPassword: string;
	proxyEnabled: boolean;
	highlightRegex?: string;
	ignoreList: any[];
};

class Network {
	nick!: string;
	name!: string;
	host!: string;
	port!: number;
	tls!: boolean;
	userDisconnected!: boolean;
	rejectUnauthorized!: boolean;
	password!: string;
	awayMessage!: string;
	commands!: any[];
	username!: string;
	realname!: string;
	leaveMessage!: string;
	sasl!: string;
	saslAccount!: string;
	saslPassword!: string;
	channels!: Chan[];
	uuid!: string;
	proxyHost!: string;
	proxyPort!: number;
	proxyUsername!: string;
	proxyPassword!: string;
	proxyEnabled!: boolean;
	highlightRegex?: RegExp;

	chanCache!: Chan[];
	ignoreList!: IgnoreList;
	keepNick!: string | null;

	status!: NetworkStatus;

	serverOptions!: {
		CHANTYPES: string[];
		PREFIX: Prefix;
		NETWORK: string;
	};

	// TODO: this is only available on export
	hasSTSPolicy!: boolean;

	constructor(attr?: Partial<Network>) {
		_.defaults(this, attr, {
			name: "",
			nick: "",
			host: "",
			port: 6667,
			tls: false,
			userDisconnected: false,
			rejectUnauthorized: false,
			password: "",
			awayMessage: "",
			commands: [],
			username: "",
			realname: "",
			leaveMessage: "",
			sasl: "",
			saslAccount: "",
			saslPassword: "",
			channels: [],
			serverOptions: {
				CHANTYPES: ["#", "&"],
				PREFIX: new Prefix([
					{symbol: "!", mode: "Y"},
					{symbol: "@", mode: "o"},
					{symbol: "%", mode: "h"},
					{symbol: "+", mode: "v"},
				]),
				NETWORK: "",
			},

			proxyHost: "",
			proxyPort: 1080,
			proxyUsername: "",
			proxyPassword: "",
			proxyEnabled: false,

			chanCache: [],
			ignoreList: [],
			keepNick: null,
		});

		if (!this.uuid) {
			this.uuid = uuidv4();
		}

		if (!this.name) {
			this.name = this.host;
		}

		this.channels.unshift(
			new Chan({
				name: this.name,
				type: ChanType.LOBBY,
				// The lobby only starts as muted if every channel (unless it's special) is muted.
				// This is A) easier to implement and B) stops some confusion on startup.
				muted:
					this.channels.length >= 1 &&
					this.channels.every((chan) => chan.muted || chan.type === ChanType.SPECIAL),
			})
		);
	}

	validate(this: Network, client: any) {
		// Remove !, :, @ and whitespace characters from nicknames and usernames
		const cleanNick = (str: string) => str.replace(/[\x00\s:!@]/g, "_").substring(0, 100);

		// Remove new lines and limit length
		const cleanString = (str: string) => str.replace(/[\x00\r\n]/g, "").substring(0, 300);

		this.setNick(cleanNick(String(this.nick || Config.getDefaultNick())));

		if (!this.username) {
			// If username is empty, make one from the provided nick
			this.username = this.nick.replace(/[^a-zA-Z0-9]/g, "");
		}

		this.username = cleanString(this.username) || "nexuslounge";
		this.realname = cleanString(this.realname) || this.nick;
		this.leaveMessage = cleanString(this.leaveMessage);
		this.password = cleanString(this.password);
		this.host = cleanString(this.host).toLowerCase();
		this.name = cleanString(this.name);
		this.saslAccount = cleanString(this.saslAccount);
		this.saslPassword = cleanString(this.saslPassword);

		this.proxyHost = cleanString(this.proxyHost);
		this.proxyPort = this.proxyPort || 1080;
		this.proxyUsername = cleanString(this.proxyUsername);
		this.proxyPassword = cleanString(this.proxyPassword);
		this.proxyEnabled = !!this.proxyEnabled;

		const error = function (network: Network, text: string) {
			network.getLobby().pushMessage(
				client,
				new Msg({
					type: MessageType.ERROR,
					text: text,
				}),
				true
			);
		};

		if (!this.port) {
			this.port = this.tls ? 6697 : 6667;
		}

		if (!["", "plain", "external"].includes(this.sasl)) {
			this.sasl = "";
		}

		if (Config.values.lockNetwork) {
			// This check is needed to prevent invalid user configurations
			if (this.host && this.host.length > 0 && this.host !== Config.values.defaults.host) {
				error(this, `The hostname you specified (${this.host}) is not allowed.`);
				return false;
			}

			this.host = Config.values.defaults.host;
			this.port = Config.values.defaults.port;
			this.tls = Config.values.defaults.tls;
			this.rejectUnauthorized = Config.values.defaults.rejectUnauthorized;
		}

		if (this.host.length === 0) {
			error(this, "You must specify a hostname to connect.");
			return false;
		}

		const stsPolicy = STSPolicies.get(this.host);

		if (stsPolicy && !this.tls) {
			error(
				this,
				`${this.host} has an active strict transport security policy, will connect to port ${stsPolicy.port} over a secure connection.`
			);

			this.port = stsPolicy.port;
			this.tls = true;
			this.rejectUnauthorized = true;
		}

		return true;
	}

	async edit(client: any, args: any) {
		const oldNetworkName = this.name;
		const oldNick = this.nick;
		const oldRealname = this.realname;

		this.keepNick = null;
		this.nick = args.nick;
		this.host = String(args.host || "");
		this.name = String(args.name || "") || this.host;
		this.port = parseInt(args.port, 10);
		this.tls = !!args.tls;
		this.rejectUnauthorized = !!args.rejectUnauthorized;
		this.password = String(args.password || "");
		this.username = String(args.username || "");
		this.realname = String(args.realname || "");
		this.leaveMessage = String(args.leaveMessage || "");
		this.sasl = String(args.sasl || "");
		this.saslAccount = String(args.saslAccount || "");
		this.saslPassword = String(args.saslPassword || "");

		this.proxyHost = String(args.proxyHost || "");
		this.proxyPort = parseInt(args.proxyPort, 10);
		this.proxyUsername = String(args.proxyUsername || "");
		this.proxyPassword = String(args.proxyPassword || "");
		this.proxyEnabled = !!args.proxyEnabled;

		// Split commands into an array
		this.commands = String(args.commands || "")
			.replace(/\r\n|\r|\n/g, "\n")
			.split("\n")
			.filter((command) => command.length > 0);

		// Sync lobby channel name
		this.getLobby().name = this.name;

		if (this.name !== oldNetworkName) {
			// Send updated network name to all connected clients
			client.emit("network:name", {
				uuid: this.uuid,
				name: this.name,
			});
		}

		if (!this.validate(client)) {
			return;
		}

		// Network editing in proxy mode is handled by irssi backend
		client.save();
	}

	destroy() {
		this.channels.forEach((channel) => channel.destroy());
	}

	setNick(this: Network, nick: string) {
		this.nick = nick;
		this.highlightRegex = new RegExp(
			// Do not match characters and numbers (unless IRC color)
			"(?:^|[^a-z0-9]|\x03[0-9]{1,2})" +
				// Escape nickname, as it may contain regex stuff
				_.escapeRegExp(nick) +
				// Do not match characters and numbers
				"(?:[^a-z0-9]|$)",

			// Case insensitive search
			"i"
		);

		if (this.keepNick === nick) {
			this.keepNick = null;
		}
	}

	getFilteredClone(lastActiveChannel?: number, lastMessage?: number): SharedNetwork {
		return {
			uuid: this.uuid,
			name: this.name,
			nick: this.nick,
			serverOptions: this.serverOptions,
			status: this.getNetworkStatus(),
			channels: this.channels.map((channel) =>
				channel.getFilteredClone(lastActiveChannel, lastMessage)
			),
		};
	}

	getNetworkStatus() {
		// In proxy mode, network status is managed by irssi backend
		return this.status;
	}

	addChannel(newChan: Chan) {
		let index = this.channels.length; // Default to putting as the last item in the array

		// Don't sort special channels in amongst channels/users.
		if (newChan.type === ChanType.CHANNEL || newChan.type === ChanType.QUERY) {
			// We start at 1 so we don't test against the lobby
			// Sort order: CHANNEL (alphabetically) → QUERY (alphabetically)
			for (let i = 1; i < this.channels.length; i++) {
				const compareChan = this.channels[i];

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

		this.channels.splice(index, 0, newChan);
		return index;
	}

	quit(quitMessage?: string) {
		// In proxy mode, quit is handled by irssi backend
		// https://ircv3.net/specs/extensions/sts#rescheduling-expiry-on-disconnect
		STSPolicies.refreshExpiration(this.host);
	}

	exportForEdit() {
		const fieldsToReturn = [
			"uuid",
			"name",
			"nick",
			"password",
			"username",
			"realname",
			"leaveMessage",
			"sasl",
			"saslAccount",
			"saslPassword",
			"commands",

			"proxyEnabled",
			"proxyHost",
			"proxyPort",
			"proxyUsername",
			"proxyPassword",
		];

		if (!Config.values.lockNetwork) {
			fieldsToReturn.push("host");
			fieldsToReturn.push("port");
			fieldsToReturn.push("tls");
			fieldsToReturn.push("rejectUnauthorized");
		}

		const data = _.pick(this, fieldsToReturn) as Network;

		data.hasSTSPolicy = !!STSPolicies.get(this.host);

		return data;
	}

	export() {
		const network = _.pick(this, [
			"uuid",
			"awayMessage",
			"nick",
			"name",
			"host",
			"port",
			"tls",
			"userDisconnected",
			"rejectUnauthorized",
			"password",
			"username",
			"realname",
			"leaveMessage",
			"sasl",
			"saslAccount",
			"saslPassword",
			"commands",
			"ignoreList",

			"proxyHost",
			"proxyPort",
			"proxyUsername",
			"proxyEnabled",
			"proxyPassword",
		]) as Network;

		network.channels = this.channels
			.filter(function (channel) {
				return channel.type === ChanType.CHANNEL || channel.type === ChanType.QUERY;
			})
			.map(function (chan) {
				const keys = ["name", "muted"];

				if (chan.type === ChanType.CHANNEL) {
					keys.push("key");
				} else if (chan.type === ChanType.QUERY) {
					keys.push("type");
				}

				return _.pick(chan, keys);
				// Override the type because we're omitting ID
			}) as Channel[];

		return network;
	}

	getChannel(name: string) {
		name = name.toLowerCase();

		return _.find(this.channels, function (that, i) {
			// Skip network lobby (it's always unshifted into first position)
			return i > 0 && that.name.toLowerCase() === name;
		});
	}

	getLobby() {
		return this.channels[0];
	}
}

export default Network;
