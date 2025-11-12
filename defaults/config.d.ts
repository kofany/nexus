declare const _default: {
	public: boolean;
	host: undefined;
	port: number;
	bind: undefined;
	reverseProxy: boolean;
	maxHistory: number;
	https: {
		enable: boolean;
		key: string;
		certificate: string;
		ca: string;
	};
	theme: string;
	prefetch: boolean;
	disableMediaPreview: boolean;
	prefetchStorage: boolean;
	prefetchMaxImageSize: number;
	prefetchMaxSearchSize: number;
	prefetchTimeout: number;
	fileUpload: {
		enable: boolean;
		maxFileSize: number;
		baseUrl: null;
	};
	transports: string[];
	leaveMessage: string;
	defaults: {
		name: string;
		host: string;
		port: number;
		password: string;
		tls: boolean;
		rejectUnauthorized: boolean;
		nick: string;
		username: string;
		realname: string;
		join: string;
		leaveMessage: string;
	};
	lockNetwork: boolean;
	messageStorage: string[];
	storagePolicy: {
		enabled: boolean;
		maxAgeDays: number;
		deletionPolicy: string;
	};
	useHexIp: boolean;
	webirc: null;
	identd: {
		enable: boolean;
		port: number;
	};
	oidentd: null;
	ldap: {
		enable: boolean;
		url: string;
		tlsOptions: {};
		primaryKey: string;
		searchDN: {
			rootDN: string;
			rootPassword: string;
			filter: string;
			base: string;
			scope: string;
		};
	};
	debug: {
		ircFramework: boolean;
		raw: boolean;
	};
};
export default _default;
