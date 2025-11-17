import pino from "pino";
import path from "path";
import fs from "fs";
import os from "os";
import Msg from "./models/msg.js";

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
		from: msg.from?.nick || "unknown",
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

type LogLevelName = "error" | "warn" | "info" | "debug";

type LogMethod = (obj?: any, ...args: string[]) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeDeep(item));
	}

	if (isPlainObject(value)) {
		const sanitized = sanitize(value as Record<string, unknown>) as Record<string, unknown>;

		for (const [key, val] of Object.entries(sanitized)) {
			sanitized[key] = sanitizeDeep(val);
		}

		return sanitized;
	}

	return value;
}

function formatValue(value: unknown): string {
	if (value === null || typeof value === "undefined") {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}

	if (typeof value === "symbol") {
		return value.toString();
	}

	const safeValue = sanitizeDeep(value);

	if (typeof safeValue === "string") {
		return safeValue;
	}

	try {
		return JSON.stringify(safeValue);
	} catch {
		return String(value);
	}
}

function emit(level: LogLevelName, args: unknown[]): void {
	const method = logger[level].bind(logger) as LogMethod;

	if (args.length === 0) {
		method();
		return;
	}

	const [first, ...rest] = args;
	const formattedRest = rest
		.map((value) => formatValue(value))
		.filter((value) => value.length > 0);

	if (isPlainObject(first)) {
		const sanitizedFirst = sanitizeDeep(first) as Record<string, unknown>;
		method(sanitizedFirst, ...formattedRest);
		return;
	}

	const firstFormatted = formatValue(first);
	method(firstFormatted, ...formattedRest);
}

// Backward compatibility wrapper (IMPORTANT: this must be a NAMED export!)
export const log = {
	error: (...args: unknown[]) => emit("error", args),
	warn: (...args: unknown[]) => emit("warn", args),
	info: (...args: unknown[]) => emit("info", args),
	debug: (...args: unknown[]) => emit("debug", args),
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
