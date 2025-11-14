/**
 * fe-web Encryption Helper (Server-side) v1.5
 *
 * Implements AES-256-GCM encryption for fe-web WebSocket messages.
 * Compatible with fe-web v1.5 dual-layer security requirements.
 *
 * ⚠️ IMPORTANT: fe-web v1.5 ENFORCES dual-layer security:
 * - Layer 1: SSL/TLS (wss://) - self-signed certificate
 * - Layer 2: AES-256-GCM - application-level encryption
 *
 * This is a server-side port using Node.js crypto API.
 */

import crypto from "crypto";
import log from "../log.js";

/**
 * FIXED salt for fe-web v1.5 protocol
 * MUST match server exactly: "irssi-fe-web-v1" (15 bytes UTF-8)
 */
const FE_WEB_SALT = "irssi-fe-web-v1";

/**
 * Encryption helper for fe-web messages
 *
 * Algorithm: AES-256-GCM (Galois/Counter Mode)
 * - Key size: 256 bits (32 bytes)
 * - IV size: 96 bits (12 bytes) - random per message
 * - Tag size: 128 bits (16 bytes) - authentication tag
 *
 * Key Derivation: PBKDF2-HMAC-SHA256
 * - Password: WebSocket password (from URL parameter)
 * - Salt: "irssi-fe-web-v1" (FIXED, 15 bytes UTF-8)
 * - Iterations: 10,000
 * - Output: 256-bit key
 *
 * Message Format:
 * [IV (12 bytes)] [Ciphertext (variable)] [Auth Tag (16 bytes)]
 *
 * Performance: Static cache for derived keys (shared across instances)
 * - Eliminates repeated PBKDF2 derivations (10,000 iterations each)
 */
export class FeWebEncryption {
	private password: string;
	private key: Buffer | null = null;
	private enabled: boolean;

	// Static cache for derived keys (shared across instances)
	private static keyCache = new Map<string, Buffer>();
	private static readonly MAX_CACHE_SIZE = 100;

	/**
	 * @param password - WebSocket password (used for key derivation with FIXED salt)
	 * @param enabled - Enable/disable encryption (default: true)
	 */
	constructor(password: string, enabled: boolean = true) {
		this.password = password;
		this.enabled = enabled;
	}

	/**
	 * Derive encryption key from password using PBKDF2 with caching
	 *
	 * Uses FIXED salt "irssi-fe-web-v1" as per fe-web v1.5 protocol
	 * PBKDF2 is expensive (10,000 iterations), so cache the result
	 */
	async deriveKey(): Promise<void> {
		if (!this.enabled || !this.password) {
			log.debug("[FeWebEncryption] Encryption disabled or no password");
			return;
		}

		// Check if key is already derived for this instance
		if (this.key) {
			return;
		}

		const cacheKey = `${this.password}:${FE_WEB_SALT}:10000`;

		// Check static cache first
		if (FeWebEncryption.keyCache.has(cacheKey)) {
			log.debug("[FeWebEncryption] Using cached derived key");
			this.key = FeWebEncryption.keyCache.get(cacheKey)!;
			return;
		}

		// Derive key (expensive operation)
		log.debug("[FeWebEncryption] Deriving new encryption key (PBKDF2)");

		return new Promise((resolve, reject) => {
			crypto.pbkdf2(
				this.password,
				FE_WEB_SALT, // FIXED salt for fe-web v1.5
				10000, // iterations (MUST be 10,000)
				32, // key length (256 bits)
				"sha256",
				(err, derivedKey) => {
					if (err) {
						reject(err);
						return;
					}

					this.key = derivedKey;

					// Cache with LRU eviction
					if (FeWebEncryption.keyCache.size >= FeWebEncryption.MAX_CACHE_SIZE) {
						const firstKey = FeWebEncryption.keyCache.keys().next().value;

						if (firstKey !== undefined) {
							FeWebEncryption.keyCache.delete(firstKey);
							log.debug("[FeWebEncryption] Evicted oldest cached key (LRU)");
						}
					}

					FeWebEncryption.keyCache.set(cacheKey, this.key);
					log.debug(
						"[FeWebEncryption] Encryption key derived successfully (fe-web v1.5)"
					);
					resolve();
				}
			);
		});
	}

	/**
	 * Encrypt a JSON message
	 *
	 * @param plaintext - JSON string to encrypt
	 * @returns Binary data: IV (12 bytes) + Ciphertext + Tag (16 bytes)
	 */
	async encrypt(plaintext: string): Promise<Buffer> {
		if (!this.enabled || !this.key) {
			// If encryption disabled, return plaintext as UTF-8 bytes
			return Buffer.from(plaintext, "utf8");
		}

		// Generate random IV (12 bytes for GCM)
		const iv = crypto.randomBytes(12);

		// Create cipher
		const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);

		// Encrypt plaintext
		const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

		// Get authentication tag
		const tag = cipher.getAuthTag();

		// Build message: IV + ciphertext + tag
		const message = Buffer.concat([iv, encrypted, tag]);

		return message;
	}

	/**
	 * Decrypt a binary message
	 *
	 * @param data - Binary data: IV (12 bytes) + Ciphertext + Tag (16 bytes)
	 * @returns Decrypted JSON string
	 */
	async decrypt(data: Buffer): Promise<string> {
		if (!this.enabled || !this.key) {
			// If encryption disabled, data is plain text
			return data.toString("utf8");
		}

		// Extract IV, ciphertext, and tag
		const iv = data.slice(0, 12);
		const tag = data.slice(-16);
		const ciphertext = data.slice(12, -16);

		try {
			// Create decipher
			const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
			decipher.setAuthTag(tag);

			// Decrypt and verify auth tag
			const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

			// Decode to string
			return plaintext.toString("utf8");
		} catch (error) {
			log.error(`[FeWebEncryption] Decryption failed: ${error}`);
			throw new Error("Decryption failed - invalid key or corrupted data");
		}
	}

	/**
	 * Check if encryption is enabled and key is derived
	 */
	get isReady(): boolean {
		return !this.enabled || this.key !== null;
	}

	/**
	 * Check if encryption is enabled
	 */
	get isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Clear all cached keys (call on password change)
	 */
	static clearKeyCache(): void {
		log.info("[FeWebEncryption] Clearing all cached encryption keys");
		FeWebEncryption.keyCache.clear();
	}

	/**
	 * Clear specific user's cached key
	 */
	static clearKeyCacheForPassword(password: string): void {
		const cacheKey = `${password}:${FE_WEB_SALT}:10000`;
		if (FeWebEncryption.keyCache.delete(cacheKey)) {
			log.debug(`[FeWebEncryption] Cleared cached key for password`);
		}
	}

	/**
	 * Update encryption key (used when password changes)
	 */
	async updateKey(newPassword: string): Promise<void> {
		// Remove old cache entry if password changed
		if (this.password && this.password !== newPassword) {
			FeWebEncryption.clearKeyCacheForPassword(this.password);
		}

		this.password = newPassword;
		this.key = null;
		await this.deriveKey();
	}
}
