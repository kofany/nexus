import chalk from "chalk";
import {read} from "read";
import util from "util";

function timestamp() {
	const datetime = new Date().toISOString().split(".")[0].replace("T", " ");

	return chalk.dim(datetime);
}

const EOL = process.platform === "win32" ? "\r\n" : "\n";

function formatArgs(args: unknown[]): string {
	return args
		.map((arg) =>
			typeof arg === "string"
				? arg
				: util.inspect(arg, {
						breakLength: Number.POSITIVE_INFINITY,
						colors: false,
						depth: null,
					})
		)
		.join(" ");
}

function writeLine(stream: NodeJS.WriteStream, prefix: string, args: unknown[]): void {
	const formattedArgs = formatArgs(args);
	const parts = [timestamp(), prefix];

	if (formattedArgs) {
		parts.push(formattedArgs);
	}

	stream.write(parts.join(" ") + EOL);
}

function writeRaw(stream: NodeJS.WriteStream, args: unknown[]): void {
	const output = formatArgs(args);
	stream.write((output || "") + EOL);
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
	error(...args: unknown[]) {
		writeLine(process.stderr, chalk.red("[ERROR]"), args);
	},
	warn(...args: unknown[]) {
		if (logLevel >= 1) {
			writeLine(process.stderr, chalk.yellow("[WARN]"), args);
		}
	},
	info(...args: unknown[]) {
		if (logLevel >= 2) {
			writeLine(process.stdout, chalk.blue("[INFO]"), args);
		}
	},
	debug(...args: unknown[]) {
		if (logLevel >= 3) {
			writeLine(process.stdout, chalk.green("[DEBUG]"), args);
		}
	},
	raw(...args: unknown[]) {
		writeRaw(process.stdout, args);
	},

	async prompt(
		options: {prompt?: string; default?: string; text: string; silent?: boolean},
		callback: (error: Error | null, result: string, isDefault: boolean) => void
	): Promise<void> {
		options.prompt = [timestamp(), chalk.cyan("[PROMPT]"), options.text].join(" ");

		try {
			const result = await read(options);
			callback(null, result, false);
		} catch (error) {
			callback(error as Error, "", false);
		}
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
