import pino from "pino";
import path from "path";
import fs from "fs";
import os from "os";
import Msg from "./models/msg.js";

// Determine environment
const isDevelopment = process.env.NODE_ENV === "development";
const isProduction = process.env.NODE_ENV === "production";

// Log level configuration
// Production: only WARN and ERROR → file
// Development: all levels → console (pretty print)
const getLogLevel = (): pino.Level => {
	if (process.env.LOG_LEVEL) {
		return process.env.LOG_LEVEL.toLowerCase() as pino.Level;
	}

	return isProduction ? "warn" : "debug";
};

// Log directory setup for production
const getLogPath = (): string => {
	// Get NEXUSIRC_HOME or default to ~/.nexusirc
	const home = process.env.NEXUSIRC_HOME || path.join(os.homedir(), ".nexusirc");
	const logsDir = path.join(home, "logs");

	if (!fs.existsSync(logsDir)) {
		fs.mkdirSync(logsDir, {recursive: true});
	}

	return path.join(logsDir, "nexusirc.log");
};

// PRIVACY PROTECTION: Sanitization helpers
// These functions ensure NO user message content ever appears in logs

/**
 * Sanitize any object by removing sensitive fields that may contain user conversation data
 */
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

/**
 * Redact a Msg object to safe-to-log format
 * Only keeps: id, type, time, from.nick (NO message content)
 */
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

/**
 * Redact generic message objects (fe-web, weechat, etc.)
 * Keeps structure but removes all content fields
 */
export function redactMessage(message: any): Record<string, unknown> {
	const safe: Record<string, unknown> = {
		type: message.type || "unknown",
	};

	// Safe fields that don't contain user message content
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

	// Redact sensitive fields automatically (defense in depth)
	redact: {
		paths: [
			"*.text",
			"*.content",
			"*.message",
			"*.body",
			"*.password",
			"*.token",
			"*.secret",
			"msg.text",
			"message.text",
			"data.text",
		],
		censor: "[REDACTED]",
	},

	// Custom serializers for common objects
	serializers: {
		err: pino.stdSerializers.err,
		req: pino.stdSerializers.req,
		res: pino.stdSerializers.res,
	},

	// Timestamp format
	timestamp: pino.stdTimeFunctions.isoTime,

	// Base fields
	base: {
		pid: process.pid,
		hostname: undefined, // Don't include hostname for privacy
	},
};

// Transport configuration
let transport: pino.TransportMultiOptions | pino.TransportSingleOptions | undefined;

if (isDevelopment) {
	// Development: pretty print to console
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
	// Production: JSON to file with rotation
	const logPath = getLogPath();

	transport = {
		target: "pino-roll",
		options: {
			file: logPath,
			frequency: "daily",
			size: "10m", // Rotate at 10MB
			limit: {count: 10}, // Keep 10 files
			mkdir: true,
		},
	};
}

// Create logger instance
const logger = pino(pinoConfig, transport ? pino.transport(transport) : undefined);

// Export logger as default
export default logger;

// Strip ANSI color codes from strings (for clean JSON logs in production)
function stripAnsi(str: string): string {
	return str.replace(/\u001b\[\d+m/g, "");
}

// Backward compatibility wrapper for old log.* API
// Handles variadic args like old console-style logging
// Helper to safely convert any value to string
function toLogString(a: unknown): string {
	if (a === null || a === undefined) {
		return String(a);
	}

	if (typeof a === "object") {
		return JSON.stringify(a);
	}

	// At this point, a is a primitive (string, number, boolean, symbol, bigint)
	return String(a as string | number | boolean | symbol | bigint);
}

export const log = {
	error(...args: unknown[]) {
		const msg = args.map(toLogString).join(" ");
		logger.error(stripAnsi(msg));
	},
	warn(...args: unknown[]) {
		const msg = args.map(toLogString).join(" ");
		logger.warn(stripAnsi(msg));
	},
	info(...args: unknown[]) {
		const msg = args.map(toLogString).join(" ");
		logger.info(stripAnsi(msg));
	},
	debug(...args: unknown[]) {
		const msg = args.map(toLogString).join(" ");
		logger.debug(stripAnsi(msg));
	},
	raw(...args: unknown[]) {
		// Raw output not supported in structured logging
		// Output to stdout directly (like old log.raw)
		process.stdout.write(args.join(" ") + "\n");
	},
	async prompt(
		options: {prompt?: string; default?: string; text: string; silent?: boolean},
		callback: (error: Error | null, result: string, isDefault: boolean) => void
	): Promise<void> {
		// Import read dynamically to avoid circular dependencies
		const {read} = await import("read");
		options.prompt = options.text;

		try {
			const result = await read(options);
			callback(null, result, false);
		} catch (error) {
			callback(error as Error, "", false);
		}
	},
	getLogLevel() {
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
	setLogLevel(level: number) {
		const levelNames = ["trace", "debug", "info", "warn", "error", "fatal"];
		logger.level = levelNames[level] || "info";
	},
};
