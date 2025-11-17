import pino from "pino";
import path from "path";
import fs from "fs";
import os from "os";
import type Msg from "./models/msg.js";

// Environment detection
const isDevelopment = process.env.NODE_ENV === "development";
const isProduction = process.env.NODE_ENV === "production";

// Log level (production: warn, development: debug)
const getLogLevel = (): pino.Level => {
	if (process.env.LOG_LEVEL) {
		return process.env.LOG_LEVEL.toLowerCase() as pino.Level;
	}
	return isProduction ? "warn" : "debug";
};

// Log directory setup
const getLogPath = (): string => {
	const home = process.env.NEXUSIRC_HOME || path.join(os.homedir(), ".nexusirc");
	const logsDir = path.join(home, "logs");
	if (!fs.existsSync(logsDir)) {
		fs.mkdirSync(logsDir, {recursive: true});
	}
	return path.join(logsDir, "nexusirc.log");
};

// PRIVACY PROTECTION: Sanitization helpers
export function sanitize<T extends Record<string, unknown>>(obj: T): Partial<T> {
	if (!obj || typeof obj !== "object") {
		return obj;
	}

	const sanitized = {...obj};
	const sensitiveFields = ["text", "content", "message", "body", "data", "command"];

	for (const field of sensitiveFields) {
		if (field in sanitized) {
			delete sanitized[field];
		}
	}

	return sanitized;
}

export function redactMsg(msg: Msg): Record<string, unknown> {
	return {
		id: msg.id,
		type: msg.type,
		time: msg.time,
		from: (msg.from as any)?.nick || "unknown",
		target: (msg.target as any)?.nick || (msg.target as any)?.name || undefined,
		// NEVER include: text, content, hostmask, etc.
	};
}

export function redactMessage(message: any): Record<string, unknown> {
	const safe: Record<string, unknown> = {
		type: message.type || "unknown",
	};

	const allowedFields = ["id", "server", "channel", "nick", "timestamp", "status"];

	for (const field of allowedFields) {
		if (field in message) {
			safe[field] = message[field];
		}
	}

	return safe;
}

// Pino configuration
const pinoConfig: pino.LoggerOptions = {
	level: getLogLevel(),

	// Auto-redact sensitive fields (defense in depth)
	redact: {
		paths: [
			"*.text",
			"*.content",
			"*.message",
			"*.body",
			"*.password",
			"*.token",
			"*.secret",
			"*.command",
			"msg.text",
			"message.text",
			"data.text",
		],
		censor: "[REDACTED]",
	},

	serializers: {
		err: pino.stdSerializers.err,
		req: pino.stdSerializers.req,
		res: pino.stdSerializers.res,
	},

	timestamp: pino.stdTimeFunctions.isoTime,

	base: {
		pid: process.pid,
		hostname: undefined,
	},
};

// Transport configuration
let transport: pino.TransportMultiOptions | pino.TransportSingleOptions | undefined;

if (isDevelopment) {
	transport = {
		target: "pino-pretty",
		options: {
			colorize: true,
			translateTime: "SYS:HH:MM:ss",
			ignore: "pid,hostname",
			singleLine: false,
		},
	};
} else if (isProduction) {
	const logPath = getLogPath();

	transport = {
		target: "pino-roll",
		options: {
			file: logPath,
			frequency: "daily",
			size: "10m",
			limit: {count: 10},
			mkdir: true,
		},
	};
}

// Create logger instance
const logger = pino(pinoConfig, transport ? pino.transport(transport) : undefined);

// Export logger as default
export default logger;

// Backward compatibility wrapper (IMPORTANT: this must be a NAMED export!)
export const log = {
	error: (...args: unknown[]) => {
		const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
		logger.error(msg);
	},
	warn: (...args: unknown[]) => {
		const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
		logger.warn(msg);
	},
	info: (...args: unknown[]) => {
		const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
		logger.info(msg);
	},
	debug: (...args: unknown[]) => {
		const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
		logger.debug(msg);
	},
	raw: (...args: unknown[]) => {
		process.stdout.write(args.join(" ") + "\n");
	},
	async prompt(
		options: {prompt?: string; default?: string; text: string; silent?: boolean},
		callback: (error: Error | null, result: string, isDefault: boolean) => void
	): Promise<void> {
		const {read} = await import("read");
		options.prompt = options.text;
		try {
			const result = await read(options);
			callback(null, result, false);
		} catch (error) {
			callback(error as Error, "", false);
		}
	},
	getLogLevel: () => {
		const levels: Record<string, number> = {
			trace: 0,
			debug: 1,
			info: 2,
			warn: 3,
			error: 4,
			fatal: 5,
		};
		return levels[logger.level] ?? 2;
	},
	setLogLevel: (level: number) => {
		const levelNames = ["trace", "debug", "info", "warn", "error", "fatal"];
		logger.level = levelNames[level] || "info";
	},
};
