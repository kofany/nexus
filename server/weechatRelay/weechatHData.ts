/**
 * WeeChat Relay HData Builder
 * 
 * HData is the most complex data type in WeeChat Relay protocol.
 * It represents structured data with multiple objects, each with multiple fields.
 * 
 * Format:
 * - hpath: path to data (e.g., "buffer:0x12345678")
 * - keys: comma-separated list of "key:type" pairs (e.g., "id:ptr,number:int,name:str")
 * - count: number of objects
 * - objects: for each object:
 *   - pointers: one pointer per path element
 *   - values: one value per key
 */

import {WeeChatMessage, OBJ_HDATA, OBJ_INT, OBJ_LONG, OBJ_STRING, OBJ_POINTER, OBJ_TIME, OBJ_CHAR, OBJ_BUFFER, OBJ_ARRAY} from "./weechatProtocol";

export interface HDataField {
	name: string;
	type: "chr" | "int" | "lon" | "str" | "buf" | "ptr" | "tim" | "arr";
	arrayType?: "int" | "str"; // For array types
}

export interface HDataObject {
	pointers: (number | bigint)[];
	values: Record<string, any>;
}

/**
 * Build HData message
 */
export function buildHData(
	msg: WeeChatMessage,
	hpath: string,
	fields: HDataField[],
	objects: HDataObject[]
): void {
	// Add HData type
	msg.addType(OBJ_HDATA);

	// Add h-path
	msg.addString(hpath);

	// Build keys string (e.g., "id:ptr,number:int,name:str")
	const keys = fields.map((f) => {
		if (f.type === "arr" && f.arrayType) {
			return `${f.name}:${f.type}:${f.arrayType}`;
		}
		return `${f.name}:${f.type}`;
	}).join(",");
	msg.addString(keys);

	// Add count
	msg.addInt(objects.length);

	// Add objects
	for (const obj of objects) {
		// Add pointers (one per path element)
		for (const ptr of obj.pointers) {
			msg.addPointer(ptr);
		}

		// Add values (one per field)
		for (const field of fields) {
			const value = obj.values[field.name];

			switch (field.type) {
				case "chr":
					msg.addChar(value ?? 0);
					break;
				case "int":
					msg.addInt(value ?? 0);
					break;
				case "lon":
					msg.addLong(value ?? 0);
					break;
				case "str":
					msg.addString(value ?? null);
					break;
				case "buf":
					msg.addBuffer(value ?? null);
					break;
				case "ptr":
					msg.addPointer(value ?? null);
					break;
				case "tim":
					msg.addTime(value ?? 0);
					break;
				case "arr":
					if (field.arrayType) {
						msg.addArray(field.arrayType, value ?? []);
					} else {
						throw new Error(`Array field ${field.name} missing arrayType`);
					}
					break;
				default:
					throw new Error(`Unsupported field type: ${field.type}`);
			}
		}
	}
}

/**
 * Helper: Build empty HData (when no data available)
 */
export function buildEmptyHData(msg: WeeChatMessage): void {
	msg.addType(OBJ_HDATA);
	msg.addString(null); // h-path
	msg.addString(null); // keys
	msg.addInt(0); // count
}

/**
 * Helper: Generate pointer from string (for buffer IDs, etc.)
 */
export function stringToPointer(str: string): bigint {
	// Simple hash function to generate consistent pointers
	let hash = 0n;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5n) - hash) + BigInt(str.charCodeAt(i));
		hash = hash & 0xFFFFFFFFFFFFFFFFn; // Keep it 64-bit
	}
	// Ensure it's non-zero and positive
	return hash === 0n ? 1n : (hash < 0n ? -hash : hash);
}

/**
 * Helper: Generate unique pointer
 */
let pointerCounter = 0x1000000n;
export function generatePointer(): bigint {
	return pointerCounter++;
}

/**
 * Helper: Parse WeeChat color codes (for compatibility)
 * WeeChat uses color codes like \x19F (foreground), \x19B (background), etc.
 * For now, we'll strip them since erssi uses different format
 */
export function stripWeeChatColors(text: string): string {
	// Remove WeeChat color codes (\x19 followed by color code)
	return text.replace(/\x19[FB@*!/_|E\d]/g, "");
}

/**
 * Helper: Convert erssi colors to WeeChat colors
 *
 * Erssi uses mIRC color codes (\x03NN or \x03NN,NN)
 * WeeChat uses \x19 followed by color code
 *
 * WeeChat color codes:
 * - \x19F + color = foreground color
 * - \x19B + color = background color
 * - \x19* = bold
 * - \x19_ = underline
 * - \x19/ = italic
 * - \x19| = keep attributes
 * - \x19E = reset
 */
export function convertToWeeChatColors(text: string): string {
	if (!text) return text;

	// mIRC to WeeChat color mapping
	const colorMap: Record<string, string> = {
		"00": "white",
		"01": "black",
		"02": "blue",
		"03": "green",
		"04": "lightred",
		"05": "red",
		"06": "magenta",
		"07": "brown",
		"08": "yellow",
		"09": "lightgreen",
		"10": "cyan",
		"11": "lightcyan",
		"12": "lightblue",
		"13": "lightmagenta",
		"14": "gray",
		"15": "lightgray",
	};

	let result = text;

	// Convert mIRC colors (\x03NN or \x03NN,NN)
	result = result.replace(/\x03(\d{1,2})(?:,(\d{1,2}))?/g, (match, fg, bg) => {
		const fgPadded = fg.padStart(2, "0");
		const fgColor = colorMap[fgPadded] || "default";

		let weechatCode = `\x19F${fgColor}`;

		if (bg) {
			const bgPadded = bg.padStart(2, "0");
			const bgColor = colorMap[bgPadded] || "default";
			weechatCode += `\x19B${bgColor}`;
		}

		return weechatCode;
	});

	// Convert mIRC bold (\x02)
	result = result.replace(/\x02/g, "\x19*");

	// Convert mIRC underline (\x1F)
	result = result.replace(/\x1F/g, "\x19_");

	// Convert mIRC italic (\x1D)
	result = result.replace(/\x1D/g, "\x19/");

	// Convert mIRC reset (\x0F)
	result = result.replace(/\x0F/g, "\x19E");

	return result;
}

