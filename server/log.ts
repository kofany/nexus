import chalk from "chalk";
import {read} from "read";

function timestamp() {
    const datetime = new Date().toISOString().split(".")[0].replace("T", " ");

    return chalk.dim(datetime);
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
        console.error(timestamp(), chalk.red("[ERROR]"), ...args);
    },
    warn(...args: string[]) {
        if (logLevel >= 1) {
            console.error(timestamp(), chalk.yellow("[WARN]"), ...args);
        }
    },
    info(...args: string[]) {
        if (logLevel >= 2) {
            console.log(timestamp(), chalk.blue("[INFO]"), ...args);
        }
    },
    debug(...args: string[]) {
        if (logLevel >= 3) {
            console.log(timestamp(), chalk.green("[DEBUG]"), ...args);
        }
    },
    raw(...args: string[]) {
        console.log(...args);
    },
    /* eslint-enable no-console */

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
