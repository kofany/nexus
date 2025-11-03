import colors from "chalk";
import read from "read";

function timestamp() {
	const datetime = new Date().toISOString().split(".")[0].replace("T", " ");

	return colors.dim(datetime);
}

// Log levels: error (0), warn (1), info (2), debug (3)
// Control via LOG_LEVEL env var or NODE_ENV
let logLevel = 2; // Default: info (production)

// Set log level based on environment
if (process.env.LOG_LEVEL) {
	const level = process.env.LOG_LEVEL.toLowerCase();
	if (level === "error") logLevel = 0;
	else if (level === "warn") logLevel = 1;
	else if (level === "info") logLevel = 2;
	else if (level === "debug") logLevel = 3;
} else if (process.env.NODE_ENV === "development") {
	logLevel = 3; // Debug in development
}

const log = {
	/* eslint-disable no-console */
	error(...args: string[]) {
		console.error(timestamp(), colors.red("[ERROR]"), ...args);
	},
	warn(...args: string[]) {
		if (logLevel >= 1) {
			console.error(timestamp(), colors.yellow("[WARN]"), ...args);
		}
	},
	info(...args: string[]) {
		if (logLevel >= 2) {
			console.log(timestamp(), colors.blue("[INFO]"), ...args);
		}
	},
	debug(...args: string[]) {
		if (logLevel >= 3) {
			console.log(timestamp(), colors.green("[DEBUG]"), ...args);
		}
	},
	raw(...args: string[]) {
		console.log(...args);
	},
	/* eslint-enable no-console */

	prompt(
		options: {prompt?: string; default?: string; text: string; silent?: boolean},
		callback: (error, result, isDefault) => void
	): void {
		options.prompt = [timestamp(), colors.cyan("[PROMPT]"), options.text].join(" ");
		read(options, callback);
	},

	// Expose log level for debugging
	getLogLevel(): number {
		return logLevel;
	},
	setLogLevel(level: number): void {
		logLevel = level;
	},
};

export default log;
