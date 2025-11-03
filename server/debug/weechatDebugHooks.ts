/**
 * WeeChat Debug Hooks
 *
 * Provides debugging instrumentation for the WeeChat relay adapter.
 * This file contains ready-to-use debugging hooks that can be inserted
 * into weechatToNodeAdapter.ts to catch the lineRequestedKeys bug.
 *
 * Copy & paste the hooks below into the appropriate locations in the adapter.
 */

import log from "../log";
import colors from "chalk";
import {VariableMutationTracker} from "./variableMutationTracker";

/**
 * Debugger configuration - control which hooks are active
 */
export const DEBUG_CONFIG = {
	TRACK_LINE_REQUESTED_KEYS: process.env.WEECHAT_TRACK_MUTATIONS === "true",
	LOG_ALL_HDATA_REQUESTS: process.env.WEECHAT_DEBUG === "true",
	VALIDATE_LINE_KEYS: process.env.WEECHAT_VALIDATE_KEYS === "true",
	CAPTURE_STACK_TRACES: process.env.WEECHAT_STACK_TRACES === "true",
	REQUEST_HISTORY: process.env.WEECHAT_REQUEST_HISTORY === "true",
};

/**
 * HOOK 1: Setup lineRequestedKeys Tracker
 *
 * Call this in the constructor of WeeChatToNodeAdapter
 *
 * Usage:
 * ```typescript
 * constructor(...) {
 *     this.lineRequestedKeys = "";
 *     this._lineRequestedKeysTracker = setupLineRequestedKeysTracker();
 * }
 * ```
 */
export function setupLineRequestedKeysTracker(): VariableMutationTracker<string> {
	const validKeys = new Set([
		"buffer",
		"id",
		"date",
		"date_usec",
		"date_printed",
		"date_usec_printed",
		"displayed",
		"notify",
		"notify_level",
		"highlight",
		"tags_array",
		"prefix",
		"message",
	]);

	const validator = (value: string): {valid: boolean; error?: string} => {
		if (!value) return {valid: true}; // Empty is ok

		const keys = value.split(",").map((k) => k.trim());
		const invalidKeys = keys.filter((k) => !validKeys.has(k));

		if (invalidKeys.length > 0) {
			return {
				valid: false,
				error: `Invalid keys: ${invalidKeys.join(", ")}`,
			};
		}

		return {valid: true};
	};

	const tracker = new VariableMutationTracker<string>("lineRequestedKeys", "", {
		validator: DEBUG_CONFIG.VALIDATE_LINE_KEYS ? validator : undefined,
		captureStackTrace: DEBUG_CONFIG.CAPTURE_STACK_TRACES,
		stackTraceDepth: 6,
	});

	// Log mutations
	tracker.on("mutate", (event) => {
		log.warn(
			`${colors.magenta("[MUTATION]")} lineRequestedKeys: "${event.oldValue}" → "${
				event.newValue
			}"`
		);

		if (event.stack) {
			log.debug(`${colors.dim("  Stack:")} ${event.stack}`);
		}

		// EARLY WARNING: Suspicious field counts
		const newKeys = event.newValue ? event.newValue.split(",") : [];
		if (event.oldValue && newKeys.length === 0) {
			log.error(
				`${colors.red("[BUG RISK]")} lineRequestedKeys was cleared! Old value had ${
					event.oldValue.split(",").length
				} fields`
			);
		}
		if (
			newKeys.length > 0 &&
			newKeys.length < 3 &&
			newKeys.length !== event.oldValue.split(",").length
		) {
			log.warn(
				`${colors.yellow("[WARNING]")} Suspiciously few fields (${
					newKeys.length
				}) in lineRequestedKeys`
			);
		}
	});

	// Log validation errors
	tracker.on("validation-error", (event) => {
		log.error(
			`${colors.red("[VALIDATION ERROR]")} Invalid lineRequestedKeys: "${event.newValue}"`
		);
		log.error(`${colors.red("  Error:")} ${event.validationError}`);
		log.error(`${colors.red("  This will cause wrong field count in _buffer_line_added!")}`);
	});

	return tracker;
}

/**
 * HOOK 2: Log every HData request
 *
 * Add this at the start of handleHData() method
 *
 * Usage:
 * ```typescript
 * private handleHData(id: string, args: string): void {
 *     logHDataRequest(id, args, this.lineRequestedKeys);
 * ```
 */
export function logHDataRequest(id: string, args: string, currentLineRequestedKeys: string): void {
	if (!DEBUG_CONFIG.LOG_ALL_HDATA_REQUESTS) return;

	const spaceIdx = args.indexOf(" ");
	const path = spaceIdx > 0 ? args.substring(0, spaceIdx) : args;
	const keys = spaceIdx > 0 ? args.substring(spaceIdx + 1) : "";

	log.info(`
╔══════════════════════════════════════════════╗
║ HData Request [${id}]
╠══════════════════════════════════════════════╣
║ path: ${path}
║ keys: ${keys || "(none)"}
║ BEFORE: lineRequestedKeys = "${currentLineRequestedKeys}"
╚══════════════════════════════════════════════╝
    `);
}

/**
 * HOOK 3: Log when lineRequestedKeys is set
 *
 * Add this wherever lineRequestedKeys is modified
 *
 * Usage:
 * ```typescript
 * if (keys) {
 *     logLineKeysUpdate("bulk_request", keys, this.lineRequestedKeys);
 *     this.lineRequestedKeys = keys;
 * }
 * ```
 */
export function logLineKeysUpdate(source: string, newValue: string, oldValue: string): void {
	log.info(`
${colors.magenta("[SET lineRequestedKeys]")} from ${source}
  Old: "${oldValue}"
  New: "${newValue}"
  Field count: ${newValue.split(",").length} fields
    `);
}

/**
 * HOOK 4: Validate before sending _buffer_line_added
 *
 * Add this at the start of sendLineAdded()
 *
 * Usage:
 * ```typescript
 * private sendLineAdded(buffer: any, message: any): void {
 *     validateLineAddedState(this.lineRequestedKeys, this.clientUsesHDataHistory);
 *     // ... rest of method
 * }
 * ```
 */
export function validateLineAddedState(
	lineRequestedKeys: string,
	clientUsesHDataHistory: boolean
): {valid: boolean; issues: string[]} {
	const issues: string[] = [];

	const requestedKeys = lineRequestedKeys
		? lineRequestedKeys.split(",").map((k) => k.trim())
		: [];

	// Check for empty keys when client expects history
	if (clientUsesHDataHistory && lineRequestedKeys === "") {
		issues.push("clientUsesHDataHistory=true but lineRequestedKeys is empty");
	}

	// Check for suspiciously low field count
	if (requestedKeys.length > 0 && requestedKeys.length < 3 && clientUsesHDataHistory) {
		issues.push(
			`Suspiciously low field count (${requestedKeys.length}) for weechat-android client`
		);
	}

	// Check for just "id" and "buffer" (the bug signature)
	if (
		requestedKeys.length === 2 &&
		requestedKeys.includes("id") &&
		requestedKeys.includes("buffer")
	) {
		issues.push("BUG DETECTED: Only 'id' and 'buffer' fields - this is the crash pattern!");
	}

	if (issues.length > 0) {
		log.error(`
${colors.red("[ASSERTION FAILURE]")} sendLineAdded state is invalid:
${issues.map((issue) => `  - ${issue}`).join("\n")}
lineRequestedKeys: "${lineRequestedKeys}"
clientUsesHDataHistory: ${clientUsesHDataHistory}
        `);
	}

	return {
		valid: issues.length === 0,
		issues,
	};
}

/**
 * HOOK 5: Request history tracking
 *
 * Tracks all HData requests for post-mortem debugging
 *
 * Usage:
 * ```typescript
 * private requestTracker = new RequestHistoryTracker();
 *
 * private handleHData(id: string, args: string): void {
 *     this.requestTracker.record("hdata", args, this.lineRequestedKeys);
 *     // ... rest of method
 * }
 *
 * // In error handler:
 * log.error(this.requestTracker.getFormattedHistory());
 * ```
 */
export class RequestHistoryTracker {
	private history: Array<{
		timestamp: number;
		type: string;
		args: string;
		lineRequestedKeys: string;
		clientUsesHDataHistory?: boolean;
	}> = [];
	private maxSize: number = 50;

	record(
		type: string,
		args: string,
		lineRequestedKeys: string,
		clientUsesHDataHistory?: boolean
	): void {
		if (!DEBUG_CONFIG.REQUEST_HISTORY) return;

		this.history.push({
			timestamp: Date.now(),
			type,
			args,
			lineRequestedKeys,
			clientUsesHDataHistory,
		});

		if (this.history.length > this.maxSize) {
			this.history.shift();
		}
	}

	getFormattedHistory(): string {
		if (this.history.length === 0) return "No request history";

		const lines = ["=== Request History ==="];

		for (let i = 0; i < this.history.length; i++) {
			const entry = this.history[i];
			const time = new Date(entry.timestamp).toISOString();
			const keyCount = entry.lineRequestedKeys.split(",").length;

			lines.push(`[${i}] ${time} ${entry.type}`);
			lines.push(`    args: ${entry.args.substring(0, 100)}`);
			lines.push(`    lineRequestedKeys: "${entry.lineRequestedKeys}" (${keyCount} fields)`);
			if (entry.clientUsesHDataHistory !== undefined) {
				lines.push(`    clientUsesHDataHistory: ${entry.clientUsesHDataHistory}`);
			}
		}

		return lines.join("\n");
	}

	getLastRequest(): any {
		return this.history[this.history.length - 1] || null;
	}

	clear(): void {
		this.history = [];
	}
}

/**
 * HOOK 6: Comprehensive state logging for _buffer_line_added
 *
 * Usage:
 * ```typescript
 * private sendLineAdded(buffer: any, message: any): void {
 *     logLineAddedState(buffer, message, this.lineRequestedKeys, this.clientUsesHDataHistory);
 *     // ... rest of method
 * }
 * ```
 */
export function logLineAddedState(
	buffer: any,
	message: any,
	lineRequestedKeys: string,
	clientUsesHDataHistory: boolean
): void {
	const requestedKeys = lineRequestedKeys
		? lineRequestedKeys.split(",").map((k) => k.trim())
		: [];

	log.info(`
${colors.cyan("[_buffer_line_added]")}
  buffer: ${buffer.fullName || buffer.pointer}
  message: "${(message.text || "").substring(0, 50)}"
  lineRequestedKeys: "${lineRequestedKeys}"
  field count: ${requestedKeys.length}
  fields: [${requestedKeys.join(", ")}]
  clientUsesHDataHistory: ${clientUsesHDataHistory}
    `);
}

/**
 * HOOK 7: Create a diagnostic report
 *
 * Use this to generate debugging info when something goes wrong
 *
 * Usage:
 * ```typescript
 * if (something_wrong) {
 *     const report = createDiagnosticReport({
 *         lineRequestedKeys: this.lineRequestedKeys,
 *         clientUsesHDataHistory: this.clientUsesHDataHistory,
 *         requestHistory: this.requestTracker.getFormattedHistory(),
 *     });
 *     log.error(report);
 * }
 * ```
 */
export function createDiagnosticReport(state: Record<string, any>): string {
	const lines = [
		"╔═══════════════════════════════════════════════════════════╗",
		"║ WeeChat Adapter Diagnostic Report                         ║",
		"╠═══════════════════════════════════════════════════════════╣",
	];

	for (const [key, value] of Object.entries(state)) {
		if (typeof value === "string" && value.length > 100) {
			lines.push(`║ ${key}:`);
			for (const line of value.split("\n")) {
				lines.push(`║   ${line}`);
			}
		} else {
			lines.push(`║ ${key}: ${JSON.stringify(value)}`);
		}
	}

	lines.push("╚═══════════════════════════════════════════════════════════╝");
	return lines.join("\n");
}

/**
 * HOOK 8: Environment variable guide
 *
 * Print this to console to show available debugging options
 */
export function printDebugOptionsGuide(): void {
	const guide = `
╔════════════════════════════════════════════════════════════════╗
║ WeeChat Debugging Environment Variables                        ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║ WEECHAT_DEBUG=true                                             ║
║   Enable verbose debug logging for all WeeChat operations     ║
║                                                                ║
║ WEECHAT_TRACK_MUTATIONS=true                                   ║
║   Log every change to lineRequestedKeys variable              ║
║                                                                ║
║ WEECHAT_STACK_TRACES=true                                      ║
║   Include stack traces with all debug logs                    ║
║                                                                ║
║ WEECHAT_VALIDATE_KEYS=true                                     ║
║   Validate lineRequestedKeys format on every change           ║
║                                                                ║
║ WEECHAT_REQUEST_HISTORY=true                                   ║
║   Track all HData requests for post-mortem analysis           ║
║                                                                ║
║ WEECHAT_DEBUG_CLIENT=<client-id>                               ║
║   Enable debug logging only for specific client               ║
║                                                                ║
║ EXAMPLE:                                                       ║
║   WEECHAT_DEBUG=true WEECHAT_TRACK_MUTATIONS=true npm start    ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `;
	console.log(guide);
}
