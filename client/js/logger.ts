/**
 * Client-side logging utility
 * Provides consistent logging interface across the client application
 * Controls log output based on environment (development vs production)
 */

// Check if we're in development mode (Vite sets this)
const isDev = import.meta.env.DEV;

const logger = {
	/**
	 * Debug level logging - only shown in development
	 * Use for detailed diagnostic information
	 */
	debug(...args: any[]): void {
		if (isDev) {
			console.log("[DEBUG]", ...args);
		}
	},

	/**
	 * Info level logging - shown in all environments
	 * Use for general informational messages
	 */
	info(...args: any[]): void {
		console.info("[INFO]", ...args);
	},

	/**
	 * Warning level logging - shown in all environments
	 * Use for potentially problematic situations
	 */
	warn(...args: any[]): void {
		console.warn("[WARN]", ...args);
	},

	/**
	 * Error level logging - shown in all environments
	 * Use for error conditions and exceptions
	 */
	error(...args: any[]): void {
		console.error("[ERROR]", ...args);
	},

	/**
	 * Raw logging without prefix - use sparingly
	 * Shown in all environments
	 */
	raw(...args: any[]): void {
		console.log(...args);
	},
};

export default logger;
