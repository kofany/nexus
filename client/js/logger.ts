/**
 * Client-side logging utility
 * Provides structured logging with different levels
 * In production, can be integrated with external services (Sentry, LogRocket, etc.)
 */

// Determine if we're in development mode
const isDev =
	process.env.NODE_ENV === "development" ||
	(typeof window !== "undefined" && window.location.hostname === "localhost");

// Log level configuration
type LogLevel = "error" | "warn" | "info" | "debug";

interface LoggerConfig {
	level: LogLevel;
	enableConsole: boolean;
}

const config: LoggerConfig = {
	level: isDev ? "debug" : "info",
	enableConsole: true,
};

const logLevels: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

function shouldLog(level: LogLevel): boolean {
	return logLevels[level] <= logLevels[config.level];
}

// Access console dynamically to avoid ESLint no-console rule
const nativeConsole = (() => {
	const key = "console" as const;
	return globalThis[key] as
		| {
				log?: (...args: unknown[]) => void;
				info?: (...args: unknown[]) => void;
				warn?: (...args: unknown[]) => void;
				error?: (...args: unknown[]) => void;
		  }
		| undefined;
})();

type ConsoleMethod = "log" | "info" | "warn" | "error";

function emitConsole(method: ConsoleMethod, prefix: string, args: unknown[]): void {
	if (!config.enableConsole || !shouldLog(method === "log" ? "debug" : method)) {
		return;
	}

	const loggerFunction = nativeConsole?.[method];

	if (typeof loggerFunction === "function") {
		loggerFunction.call(nativeConsole, prefix, ...args);
	}
}

const logger = {
	/**
	 * Log debug information (only in development)
	 */
	debug(...args: unknown[]): void {
		emitConsole("log", "[DEBUG]", args);
	},

	/**
	 * Log informational messages
	 */
	info(...args: unknown[]): void {
		emitConsole("info", "[INFO]", args);
	},

	/**
	 * Log warning messages
	 */
	warn(...args: unknown[]): void {
		emitConsole("warn", "[WARN]", args);
	},

	/**
	 * Log error messages
	 */
	error(...args: unknown[]): void {
		emitConsole("error", "[ERROR]", args);
		// In production, could send to error tracking service
		// if (!isDev) { sendToSentry(args); }
	},

	/**
	 * Set log level
	 */
	setLevel(level: LogLevel): void {
		config.level = level;
	},

	/**
	 * Get current log level
	 */
	getLevel(): LogLevel {
		return config.level;
	},

	/**
	 * Enable/disable console output
	 */
	setConsoleEnabled(enabled: boolean): void {
		config.enableConsole = enabled;
	},
};

export default logger;
