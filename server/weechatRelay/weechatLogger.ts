/**
 * Simple file logger for WeeChat Relay debugging
 * Logs to weechat-relay-debug.log in the project root
 */

import fs from "fs";
import path from "path";

const LOG_FILE = path.join(process.cwd(), "weechat-relay-debug.log");

// Initialize log file (truncate on startup)
try {
	fs.writeFileSync(
		LOG_FILE,
		`=== WeeChat Relay Debug Log Started at ${new Date().toISOString()} ===\n`
	);
} catch (err) {
	console.error(`Failed to initialize WeeChat debug log: ${err}`);
}

/**
 * Log a message to the debug file
 */
export function wlog(message: string): void {
	const timestamp = new Date().toISOString().replace("T", " ").substring(0, 23);
	const line = `${timestamp} ${message}\n`;

	try {
		fs.appendFileSync(LOG_FILE, line);
	} catch (err) {
		// Ignore write errors (don't want to break the app)
	}
}

/**
 * Log a hex dump of binary data
 */
export function wlogHex(label: string, data: Buffer): void {
	wlog(`${label} (${data.length} bytes):`);

	// Hex dump in 16-byte rows
	for (let i = 0; i < Math.min(data.length, 256); i += 16) {
		const chunk = data.subarray(i, i + 16);
		const hex = Array.from(chunk)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(" ");
		const ascii = Array.from(chunk)
			.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
			.join("");
		wlog(`  ${i.toString(16).padStart(4, "0")}: ${hex.padEnd(48, " ")}  ${ascii}`);
	}

	if (data.length > 256) {
		wlog(`  ... (${data.length - 256} more bytes)`);
	}
}

export default wlog;
