/**
 * WeeChat Relay Protocol - Binary Message Encoder/Decoder
 *
 * Implements the WeeChat Relay binary protocol for communication with clients like Lith.
 * Based on WeeChat Relay Protocol specification and weechat/src/plugins/relay/weechat/
 *
 * Message format:
 * - 4 bytes: length (uint32, big endian)
 * - 1 byte: compression flag (0=off, 1=zlib, 2=zstd)
 * - N bytes: message ID (string with length prefix)
 * - N bytes: objects (typed data)
 *
 * Object types:
 * - chr: char (1 byte)
 * - int: integer (4 bytes, big endian)
 * - lon: long integer (1 byte length + string)
 * - str: string (4 bytes length + data)
 * - buf: buffer (4 bytes length + data)
 * - ptr: pointer (1 byte length + hex string)
 * - tim: time (1 byte length + string)
 * - htb: hashtable (type + type + count + key/value pairs)
 * - hda: hdata (h-path + keys + count + objects)
 * - inf: info (name + value)
 * - inl: infolist (name + count + items)
 * - arr: array (type + count + values)
 */

import {Buffer} from "buffer";
import * as zlib from "zlib";

// Object type identifiers (3 bytes each)
export const OBJ_CHAR = "chr";
export const OBJ_INT = "int";
export const OBJ_LONG = "lon";
export const OBJ_STRING = "str";
export const OBJ_BUFFER = "buf";
export const OBJ_POINTER = "ptr";
export const OBJ_TIME = "tim";
export const OBJ_HASHTABLE = "htb";
export const OBJ_HDATA = "hda";
export const OBJ_INFO = "inf";
export const OBJ_INFOLIST = "inl";
export const OBJ_ARRAY = "arr";

// Compression flags
export const COMPRESSION_OFF = 0;
export const COMPRESSION_ZLIB = 1;
export const COMPRESSION_ZSTD = 2;

/**
 * WeeChat Relay Message Builder
 */
export class WeeChatMessage {
	private buffer: Buffer;
	private offset: number;

	constructor(id: string) {
		// Initial allocation (will grow as needed)
		this.buffer = Buffer.alloc(4096);
		this.offset = 0;

		// Reserve space for length (4 bytes) and compression flag (1 byte)
		this.offset += 5;

		// Add message ID
		this.addString(id);
	}

	/**
	 * Add raw bytes to buffer
	 */
	private addBytes(data: Buffer): void {
		// Grow buffer if needed
		while (this.offset + data.length > this.buffer.length) {
			const newBuffer = Buffer.alloc(this.buffer.length * 2);
			this.buffer.copy(newBuffer);
			this.buffer = newBuffer;
		}

		data.copy(this.buffer, this.offset);
		this.offset += data.length;
	}

	/**
	 * Add object type identifier (3 bytes)
	 */
	addType(type: string): void {
		this.addBytes(Buffer.from(type.substring(0, 3), "ascii"));
	}

	/**
	 * Add char (1 byte)
	 */
	addChar(value: number): void {
		const buf = Buffer.alloc(1);
		buf.writeInt8(value, 0);
		this.addBytes(buf);
	}

	/**
	 * Add integer (4 bytes, big endian)
	 */
	addInt(value: number): void {
		const buf = Buffer.alloc(4);
		buf.writeInt32BE(value, 0);
		this.addBytes(buf);
	}

	/**
	 * Add long integer (1 byte length + string)
	 */
	addLong(value: number | bigint): void {
		const str = value.toString();
		const buf = Buffer.alloc(1 + str.length);
		buf.writeUInt8(str.length, 0);
		buf.write(str, 1, "ascii");
		this.addBytes(buf);
	}

	/**
	 * Add string (4 bytes length + data)
	 * null string = -1 length
	 * empty string = 0 length
	 */
	addString(value: string | null): void {
		if (value === null) {
			this.addInt(-1);
		} else if (value.length === 0) {
			this.addInt(0);
		} else {
			const buf = Buffer.from(value, "utf8");
			this.addInt(buf.length);
			this.addBytes(buf);
		}
	}

	/**
	 * Add buffer (4 bytes length + data)
	 */
	addBuffer(value: Buffer | null): void {
		if (value === null) {
			this.addInt(-1);
		} else {
			this.addInt(value.length);
			if (value.length > 0) {
				this.addBytes(value);
			}
		}
	}

	/**
	 * Add pointer (1 byte length + hex string)
	 */
	addPointer(value: number | bigint | null): void {
		if (value === null || value === 0) {
			const buf = Buffer.alloc(1);
			buf.writeUInt8(1, 0);
			this.addBytes(buf);
			this.addBytes(Buffer.from("0", "ascii"));
		} else {
			const hex = value.toString(16);
			const buf = Buffer.alloc(1 + hex.length);
			buf.writeUInt8(hex.length, 0);
			buf.write(hex, 1, "ascii");
			this.addBytes(buf);
		}
	}

	/**
	 * Add time (1 byte length + string)
	 */
	addTime(value: number): void {
		const str = Math.floor(value).toString();
		const buf = Buffer.alloc(1 + str.length);
		buf.writeUInt8(str.length, 0);
		buf.write(str, 1, "ascii");
		this.addBytes(buf);
	}

	/**
	 * Add hashtable (type + type + count + key/value pairs)
	 */
	addHashtable(value: Record<string, string> | null): void {
		if (value === null) {
			// Empty hashtable
			this.addBytes(Buffer.from("str", "ascii")); // key type
			this.addBytes(Buffer.from("str", "ascii")); // value type
			this.addInt(0); // count
		} else {
			const entries = Object.entries(value);
			this.addBytes(Buffer.from("str", "ascii")); // key type
			this.addBytes(Buffer.from("str", "ascii")); // value type
			this.addInt(entries.length);
			for (const [key, val] of entries) {
				this.addString(key);
				this.addString(val);
			}
		}
	}

	/**
	 * Add info (name + value)
	 * Format: inf <name:string> <value:string>
	 */
	addInfo(name: string, value: string): void {
		this.addString(name);
		this.addString(value);
	}

	/**
	 * Add array (type + count + values)
	 */
	addArray(type: string, values: any[]): void {
		this.addBytes(Buffer.from(type.substring(0, 3), "ascii"));
		this.addInt(values.length);

		for (const value of values) {
			switch (type) {
				case OBJ_INT:
					this.addInt(value);
					break;
				case OBJ_STRING:
					this.addString(value);
					break;
				case OBJ_LONG:
					this.addLong(value);
					break;
				case OBJ_CHAR:
					this.addChar(value);
					break;
				case OBJ_POINTER:
					this.addPointer(value);
					break;
				case OBJ_TIME:
					this.addTime(value);
					break;
				default:
					throw new Error(`Unsupported array type: ${type}`);
			}
		}
	}

	/**
	 * Build final message (with length and compression flag)
	 */
	build(compress: boolean = false): Buffer {
		// Get data without header
		const data = this.buffer.slice(5, this.offset);

		if (compress) {
			// Compress with zlib
			const compressed = zlib.deflateSync(data);

			// Build final message with compression
			const result = Buffer.alloc(5 + compressed.length);
			result.writeUInt32BE(5 + compressed.length, 0);
			result.writeUInt8(COMPRESSION_ZLIB, 4);
			compressed.copy(result, 5);

			return result;
		} else {
			// Build final message without compression
			const result = Buffer.alloc(this.offset);
			result.writeUInt32BE(this.offset, 0);
			result.writeUInt8(COMPRESSION_OFF, 4);
			this.buffer.copy(result, 5, 5, this.offset);

			return result;
		}
	}
}

/**
 * WeeChat Relay Message Parser
 */
export class WeeChatParser {
	private buffer: Buffer;
	private offset: number;

	constructor(data: Buffer) {
		// Check if compressed
		const compressionFlag = data.readUInt8(4);

		if (compressionFlag === COMPRESSION_ZLIB) {
			// Decompress
			const compressed = data.slice(5);
			this.buffer = zlib.inflateSync(compressed);
			this.offset = 0;
		} else if (compressionFlag === COMPRESSION_OFF) {
			this.buffer = data.slice(5);
			this.offset = 0;
		} else {
			throw new Error(`Unsupported compression: ${compressionFlag}`);
		}
	}

	/**
	 * Read raw bytes
	 */
	private readBytes(length: number): Buffer {
		const data = this.buffer.slice(this.offset, this.offset + length);
		this.offset += length;
		return data;
	}

	/**
	 * Read object type (3 bytes)
	 */
	readType(): string {
		return this.readBytes(3).toString("ascii");
	}

	/**
	 * Read char (1 byte)
	 */
	readChar(): number {
		return this.readBytes(1).readInt8(0);
	}

	/**
	 * Read integer (4 bytes, big endian)
	 */
	readInt(): number {
		return this.readBytes(4).readInt32BE(0);
	}

	/**
	 * Read long integer (1 byte length + string)
	 */
	readLong(): bigint {
		const length = this.readBytes(1).readUInt8(0);
		const str = this.readBytes(length).toString("ascii");
		return BigInt(str);
	}

	/**
	 * Read string (4 bytes length + data)
	 */
	readString(): string | null {
		const length = this.readInt();
		if (length === -1) {
			return null;
		} else if (length === 0) {
			return "";
		} else {
			return this.readBytes(length).toString("utf8");
		}
	}

	/**
	 * Read buffer (4 bytes length + data)
	 */
	readBuffer(): Buffer | null {
		const length = this.readInt();
		if (length === -1) {
			return null;
		} else if (length === 0) {
			return Buffer.alloc(0);
		} else {
			return this.readBytes(length);
		}
	}

	/**
	 * Read pointer (1 byte length + hex string)
	 */
	readPointer(): bigint {
		const length = this.readBytes(1).readUInt8(0);
		const hex = this.readBytes(length).toString("ascii");
		return BigInt("0x" + hex);
	}

	/**
	 * Read time (1 byte length + string)
	 */
	readTime(): number {
		const length = this.readBytes(1).readUInt8(0);
		const str = this.readBytes(length).toString("ascii");
		return parseInt(str, 10);
	}

	/**
	 * Read hashtable (type + type + count + key/value pairs)
	 */
	readHashtable(): Record<string, string> {
		const keyType = this.readType();
		const valueType = this.readType();
		const count = this.readInt();

		const result: Record<string, string> = {};

		for (let i = 0; i < count; i++) {
			const key = this.readString() || "";
			const value = this.readString() || "";
			result[key] = value;
		}

		return result;
	}

	/**
	 * Check if there's more data to read
	 */
	hasMore(): boolean {
		return this.offset < this.buffer.length;
	}

	/**
	 * Get current offset
	 */
	getOffset(): number {
		return this.offset;
	}
}
