/**
 * TypeScript interfaces for irssi network/server management
 * Based on irssi/docs/fe-web/NETWORK-SERVER-MANAGEMENT-SPEC.md
 */

/**
 * IRC Network configuration (irssi format with snake_case)
 */
export interface IrssiNetwork {
	name: string;
	chat_type?: string;
	nick?: string;
	alternate_nick?: string;
	username?: string;
	realname?: string;
	own_host?: string;
	autosendcmd?: string;
	usermode?: string;
	sasl_mechanism?: string;
	sasl_username?: string;
	sasl_password?: string; // "***" in responses from irssi
	max_kicks?: number;
	max_msgs?: number;
	max_modes?: number;
	max_whois?: number;
	max_cmds_at_once?: number;
	cmd_queue_speed?: number;
	max_query_chans?: number;
}

/**
 * IRC Server configuration (irssi format with snake_case)
 */
export interface IrssiServer {
	address: string;
	port: number;
	chatnet?: string;
	password?: string; // "***" in responses from irssi
	autoconnect?: boolean;
	use_tls?: boolean;
	tls_verify?: boolean;
	tls_cert?: string;
	tls_pkey?: string;
	tls_pass?: string;
	tls_cafile?: string;
	tls_capath?: string;
	tls_ciphers?: string;
	tls_pinned_cert?: string;
	tls_pinned_pubkey?: string;
	own_host?: string;
	family?: number; // 0=auto, 2=IPv4, 10=IPv6
	max_cmds_at_once?: number;
	cmd_queue_speed?: number;
	max_query_chans?: number;
	starttls?: number;
	no_cap?: boolean;
	no_proxy?: boolean;
	last_failed?: boolean;
	banned?: boolean;
	dns_error?: boolean;
}

/**
 * Command result from irssi fe-web
 */
export interface CommandResult {
	success: boolean;
	message: string;
	error_code?: string;
}

/**
 * Network data from frontend (camelCase format)
 */
export interface NetworkFormData {
	name: string;
	nick?: string;
	alternateNick?: string;
	username?: string;
	realname?: string;
	ownHost?: string;
	autosendcmd?: string;
	usermode?: string;
	saslMechanism?: string;
	saslUsername?: string;
	saslPassword?: string;
	servers: ServerFormData[];
}

/**
 * Server data from frontend (camelCase format)
 */
export interface ServerFormData {
	address: string;
	port: number;
	password?: string;
	autoConnect?: boolean;
	useTLS?: boolean;
	tlsVerify?: boolean;
	tlsCert?: string;
	tlsPkey?: string;
	tlsPass?: string;
	tlsCafile?: string;
	tlsCapath?: string;
	ownHost?: string;
	family?: number;
	noCap?: boolean;
	noProxy?: boolean;
}

/**
 * Convert camelCase object to snake_case (for sending to irssi)
 */
export function camelToSnake(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map((item): any => camelToSnake(item));
	}

	if (typeof obj === "object") {
		const result: any = {};

		for (const key in obj) {
			if (Object.hasOwn(obj, key)) {
				const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
				result[snakeKey] = camelToSnake(obj[key]);
			}
		}

		return result;
	}

	return obj;
}

/**
 * Convert snake_case object to camelCase (for sending to frontend)
 */
export function snakeToCamel(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map((item): any => snakeToCamel(item));
	}

	if (typeof obj === "object") {
		const result: any = {};

		for (const key in obj) {
			if (Object.hasOwn(obj, key)) {
				const camelKey = key.replace(/_([a-z])/g, (_: string, letter: string): string =>
					letter.toUpperCase()
				);
				result[camelKey] = snakeToCamel(obj[key]);
			}
		}

		return result;
	}

	return obj;
}

/**
 * Convert NetworkFormData (camelCase) to IrssiNetwork (snake_case)
 */
export function networkFormToIrssi(formData: NetworkFormData): IrssiNetwork {
	return {
		name: formData.name,
		nick: formData.nick,
		alternate_nick: formData.alternateNick,
		username: formData.username,
		realname: formData.realname,
		own_host: formData.ownHost,
		autosendcmd: formData.autosendcmd,
		usermode: formData.usermode,
		sasl_mechanism: formData.saslMechanism,
		sasl_username: formData.saslUsername,
		sasl_password: formData.saslPassword,
	};
}

/**
 * Convert ServerFormData (camelCase) to IrssiServer (snake_case)
 */
export function serverFormToIrssi(formData: ServerFormData, chatnet: string): IrssiServer {
	return {
		address: formData.address,
		port: formData.port,
		chatnet: chatnet,
		password: formData.password,
		autoconnect: formData.autoConnect,
		use_tls: formData.useTLS,
		tls_verify: formData.tlsVerify,
		tls_cert: formData.tlsCert,
		tls_pkey: formData.tlsPkey,
		tls_pass: formData.tlsPass,
		tls_cafile: formData.tlsCafile,
		tls_capath: formData.tlsCapath,
		own_host: formData.ownHost,
		family: formData.family,
		no_cap: formData.noCap,
		no_proxy: formData.noProxy,
	};
}
