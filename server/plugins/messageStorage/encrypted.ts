/**
 * Encrypted Message Storage
 *
 * SQLite-based message storage with AES-256-GCM encryption.
 * Each user has their own database with messages encrypted using their encryption key.
 *
 * Database schema:
 * - messages table: stores encrypted message data
 * - Each message is encrypted as: [IV 12B][Ciphertext][Auth Tag 16B]
 */

import type {Database} from "sqlite3";
import log from "../../log.js";
import path from "path";
import fs from "fs/promises";
import Config from "../../config.js";
import Msg, {Message} from "../../models/msg.js";
import Chan, {Channel} from "../../models/chan.js";
import Helper from "../../helper.js";
import type {SearchableMessageStorage, DeletionRequest} from "./types.js";
import Network from "../../models/network.js";
import {SearchQuery, SearchResponse} from "../../../shared/types/storage.js";
import {MessageType} from "../../../shared/types/msg.js";
import crypto from "crypto";
import {createRequire} from "module";

const require = createRequire(import.meta.url);

// LRU Cache for decrypted messages (performance optimization)
class LRUCache<K, V> {
    private cache: Map<K, V>;
    private maxSize: number;

    constructor(maxSize: number = 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);

        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }

        return value;
    }

    set(key: K, value: V): void {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;

            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, value);
    }

    clear(): void {
        this.cache.clear();
    }
}

let sqlite3: any;

try {
    sqlite3 = require("sqlite3");
} catch (e: any) {
    log.error(
        "Unable to load sqlite3 module. See https://github.com/mapbox/node-sqlite3/wiki/Binaries"
    );
}

export const currentSchemaVersion = 1760689200000; // 2025-10-17 (added unread_markers table)

// Schema for encrypted message storage
const schema = [
    "CREATE TABLE options (name TEXT, value TEXT, CONSTRAINT name_unique UNIQUE (name))",
    // Encrypted messages table
    // - network, channel, time, type are plaintext for indexing/sorting/filtering
    // - encrypted_data contains: [IV 12B][Encrypted JSON][Tag 16B]
    "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT, channel TEXT, time INTEGER, type TEXT, encrypted_data BLOB)",
    "CREATE INDEX network_channel ON messages (network, channel)",
    "CREATE INDEX time ON messages (time)",
    "CREATE INDEX type ON messages (type)",
    // Unread markers table - stores last read timestamp per network+channel/query
    // - network: network UUID
    // - channel: channel name (e.g. "#linux") or query nick (e.g. "JohnDoe")
    // - last_read_time: Unix timestamp (milliseconds) when channel was last marked as read
    "CREATE TABLE unread_markers (network TEXT NOT NULL, channel TEXT NOT NULL, last_read_time INTEGER NOT NULL, PRIMARY KEY (network, channel))",
];

class Deferred {
    resolve!: () => void;
    promise: Promise<void>;

    constructor() {
        this.promise = new Promise((resolve) => {
            this.resolve = resolve;
        });
    }
}

export class EncryptedMessageStorage implements SearchableMessageStorage {
    isEnabled: boolean;
    database!: Database;
    initDone: Deferred;
    userName: string;
    private encryptionKey: Buffer;
    private cache: LRUCache<string, Message[]>;

    constructor(userName: string, encryptionKey: Buffer) {
        this.userName = userName;
        this.encryptionKey = encryptionKey;
        this.isEnabled = false;
        this.initDone = new Deferred();
        this.cache = new LRUCache(1000); // Cache up to 1000 channel histories
    }

    /**
     * Update encryption key (used when password changes)
     */
    updateEncryptionKey(newKey: Buffer): void {
        this.encryptionKey = newKey;
        this.cache.clear(); // Clear cache as old decrypted data is invalid
    }

    /**
     * Check if storage can provide messages
     */
    canProvideMessages(): boolean {
        return this.isEnabled;
    }

    /**
     * Encrypt message data
     */
    private encrypt(plaintext: string): Buffer {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);

        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

        const tag = cipher.getAuthTag();

        // Return: [IV 12B][Ciphertext][Tag 16B]
        return Buffer.concat([iv, encrypted, tag]);
    }

    /**
     * Decrypt message data
     */
    private decrypt(ciphertext: Buffer): string {
        const iv = ciphertext.slice(0, 12);
        const tag = ciphertext.slice(-16);
        const encrypted = ciphertext.slice(12, -16);

        const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
        decipher.setAuthTag(tag);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

        return decrypted.toString("utf8");
    }

    async _enable(connection_string: string) {
        this.database = new sqlite3.Database(connection_string);

        try {
            await this.run_pragmas();
            await this.run_migrations();
        } catch (e) {
            this.isEnabled = false;
            throw Helper.catch_to_error("Migration failed", e);
        }

        this.isEnabled = true;
    }

    async enable() {
        const logsPath = Config.getUserLogsPath();
        const sqlitePath = path.join(logsPath, `${this.userName}.encrypted.sqlite3`);

        try {
            await fs.mkdir(logsPath, {recursive: true});
        } catch (e) {
            throw Helper.catch_to_error("Unable to create logs directory", e);
        }

        try {
            await this._enable(sqlitePath);
        } finally {
            this.initDone.resolve();
        }
    }

    async setup_new_db() {
        for (const stmt of schema) {
            await this.serialize_run(stmt);
        }

        await this.serialize_run(
            "INSERT INTO options (name, value) VALUES ('schema_version', ?)",
            currentSchemaVersion.toString()
        );
    }

    async current_version(): Promise<number> {
        const have_options = await this.serialize_get(
            "select 1 from sqlite_master where type = 'table' and name = 'options'"
        );

        if (!have_options) {
            return 0;
        }

        const version = await this.serialize_get(
            "SELECT value FROM options WHERE name = 'schema_version'"
        );

        if (version === undefined) {
            return 0;
        }

        const storedSchemaVersion = parseInt(version.value, 10);
        return storedSchemaVersion;
    }

    async update_version_in_db() {
        return this.serialize_run(
            "UPDATE options SET value = ? WHERE name = 'schema_version'",
            currentSchemaVersion.toString()
        );
    }

    async run_pragmas() {
        await this.serialize_run("PRAGMA foreign_keys = ON;");
    }

    async run_migrations() {
        const version = await this.current_version();

        if (version > currentSchemaVersion) {
            throw `sqlite messages schema version is higher than expected (${version} > ${currentSchemaVersion}). Is Nexus Lounge out of date?`;
        } else if (version === currentSchemaVersion) {
            return; // nothing to do
        }

        await this.serialize_run("BEGIN EXCLUSIVE TRANSACTION");

        try {
            if (version === 0) {
                await this.setup_new_db();
            } else {
                // Schema is outdated - drop old tables and recreate
                log.warn(
                    `Encrypted message storage schema version ${version} is outdated (current: ${currentSchemaVersion}). Dropping old tables and creating new database.`
                );

                // Drop old tables
                await this.serialize_run("DROP TABLE IF EXISTS messages");
                await this.serialize_run("DROP TABLE IF EXISTS options");

                // Create new schema
                await this.setup_new_db();
            }
        } catch (err) {
            await this.serialize_run("ROLLBACK");
            throw err;
        }

        await this.serialize_run("COMMIT");
        await this.serialize_run("VACUUM");
    }

    async close() {
        if (!this.isEnabled) {
            return;
        }

        this.isEnabled = false;

        return new Promise<void>((resolve, reject) => {
            this.database.close((err) => {
                if (err) {
                    reject(`Failed to close sqlite database: ${err.message}`);
                    return;
                }

                resolve();
            });
        });
    }

    /**
     * Helper methods for database operations
     */
    serialize_run(stmt: string, ...params: any[]): Promise<void> {
        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.run(stmt, params, (err: Error | null) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                });
            });
        });
    }

    serialize_get(stmt: string, ...params: any[]): Promise<any> {
        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.get(stmt, params, (err: Error | null, row: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(row);
                });
            });
        });
    }

    serialize_fetchall(stmt: string, ...params: any[]): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.all(stmt, params, (err: Error | null, rows: any[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(rows);
                });
            });
        });
    }

    /**
     * Index a message (store encrypted)
     */
    async index(network: Network, channel: Channel, msg: Message) {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return;
        }

        // Clone message to avoid modifying original
        const clonedMsg = Object.keys(msg).reduce((newMsg, prop) => {
            // id is regenerated when messages are retrieved
            // previews are not stored because storage is cleared on lounge restart
            // type and time are stored in a separate column
            if (prop !== "id" && prop !== "previews" && prop !== "type" && prop !== "time") {
                newMsg[prop] = msg[prop];
            }

            return newMsg;
        }, {});

        // Encrypt message data
        const plaintext = JSON.stringify(clonedMsg);
        const encrypted = this.encrypt(plaintext);

        await this.serialize_run(
            "INSERT INTO messages(network, channel, time, type, encrypted_data) VALUES(?, ?, ?, ?, ?)",
            network.uuid,
            channel.name.toLowerCase(),
            msg.time.getTime(),
            msg.type || MessageType.MESSAGE,
            encrypted
        );

        // Invalidate cache for this channel
        const cacheKey = `${network.uuid}:${channel.name.toLowerCase()}`;
        this.cache.set(cacheKey, []); // Clear cache entry
    }

    /**
     * Delete all messages for a channel
     */
    async deleteChannel(network: Network, channel: Channel) {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return;
        }

        await this.serialize_run(
            "DELETE FROM messages WHERE network = ? AND channel = ?",
            network.uuid,
            channel.name.toLowerCase()
        );

        // Invalidate cache
        const cacheKey = `${network.uuid}:${channel.name.toLowerCase()}`;
        this.cache.set(cacheKey, []);
    }

    /**
     * Get messages for a channel (decrypt on-the-fly)
     */
    async getMessages(
        network: Network,
        channel: Channel,
        nextID: () => number
    ): Promise<Message[]> {
        await this.initDone.promise;

        if (!this.isEnabled || Config.values.maxHistory === 0) {
            return [];
        }

        const cacheKey = `${network.uuid}:${channel.name.toLowerCase()}`;

        // Check cache first
        const cached = this.cache.get(cacheKey);

        if (cached && cached.length > 0) {
            // Regenerate IDs
            return cached.map((msg) => {
                const newMsg = new Msg(msg);
                newMsg.id = nextID();
                return newMsg;
            });
        }

        // If unlimited history is specified, load 100k messages
        const limit = Config.values.maxHistory < 0 ? 100000 : Config.values.maxHistory;

        const rows = await this.serialize_fetchall(
            "SELECT encrypted_data, time, type FROM messages WHERE network = ? AND channel = ? ORDER BY time DESC LIMIT ?",
            network.uuid,
            channel.name.toLowerCase(),
            limit
        );

        // Decrypt messages
        const messages = rows.reverse().map((row: any): Message => {
            try {
                const decrypted = this.decrypt(row.encrypted_data);
                const msg = JSON.parse(decrypted);
                msg.time = row.time;
                msg.type = row.type; // Restore type from column

                const newMsg = new Msg(msg);
                newMsg.id = nextID();

                return newMsg;
            } catch (error) {
                log.error(`Failed to decrypt message: ${error}`);
                // Return error message placeholder
                return new Msg({
                    type: MessageType.UNHANDLED,
                    text: "[Decryption failed]",
                    time: row.time,
                });
            }
        });

        // Cache decrypted messages
        this.cache.set(cacheKey, messages);

        return messages;
    }

    /**
     * Search messages (requires decrypting all matching messages)
     */
    async search(query: SearchQuery): Promise<SearchResponse> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            throw new Error(
                "search called but encrypted storage provider not enabled. This is a programming error"
            );
        }

        // For encrypted storage, we need to decrypt all messages to search
        // This is a performance limitation of encryption
        let select = "SELECT encrypted_data, time, network, channel FROM messages";
        const params: any[] = [];

        if (query.networkUuid) {
            select += " WHERE network = ?";
            params.push(query.networkUuid);
        }

        if (query.channelName) {
            select += query.networkUuid ? " AND" : " WHERE";
            select += " channel = ?";
            params.push(query.channelName.toLowerCase());
        }

        select += " ORDER BY time DESC";

        const rows = await this.serialize_fetchall(select, ...params);

        // Decrypt and filter messages
        const results: Message[] = [];
        let skipped = 0;
        const maxResults = 100;

        for (const row of rows) {
            if (results.length >= maxResults) {
                break;
            }

            try {
                const decrypted = this.decrypt(row.encrypted_data);
                const msg = JSON.parse(decrypted);

                // Check if message matches search term
                if (msg.text && msg.text.toLowerCase().includes(query.searchTerm.toLowerCase())) {
                    if (skipped < query.offset) {
                        skipped++;
                        continue;
                    }

                    msg.time = row.time;
                    msg.network = row.network;
                    msg.channel = row.channel;

                    const newMsg = new Msg(msg);
                    newMsg.id = results.length; // Temporary ID

                    results.push(newMsg);
                }
            } catch (error) {
                log.error(`Failed to decrypt message during search: ${error}`);
            }
        }

        return {
            ...query,
            results: results.reverse(),
        };
    }

    /**
     * Delete messages (not implemented for encrypted storage)
     */
    async deleteMessages(req: DeletionRequest): Promise<number> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return 0;
        }

        // TODO: Implement if needed
        log.warn("deleteMessages not implemented for encrypted storage");
        return 0;
    }

    /**
     * Get message count (for cleanup)
     */
    async getMessagesForCleanup(req: DeletionRequest): Promise<Message[]> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return [];
        }

        // TODO: Implement if needed
        return [];
    }

    /**
     * Get last N messages for a channel (for initial load)
     * Used by irssi proxy mode to load messages when browser connects
     */
    async getLastMessages(
        networkUuid: string,
        channelName: string,
        limit: number
    ): Promise<Message[]> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return [];
        }

        const rows = await this.serialize_fetchall(
            "SELECT encrypted_data, time, type FROM messages WHERE network = ? AND channel = ? ORDER BY time DESC LIMIT ?",
            networkUuid,
            channelName.toLowerCase(),
            limit
        );

        // Decrypt messages (reverse to get chronological order)
        const messages = rows.reverse().map((row: any): Message => {
            try {
                const decrypted = this.decrypt(row.encrypted_data);
                const msg = JSON.parse(decrypted);
                msg.time = new Date(row.time);
                msg.type = row.type; // Restore type from column

                const newMsg = new Msg(msg);
                // ID will be assigned by caller (nextMessageId())

                return newMsg;
            } catch (error) {
                log.error(`Failed to decrypt message: ${error}`);
                // Return error message placeholder
                return new Msg({
                    type: MessageType.UNHANDLED,
                    text: "[Decryption failed]",
                    time: new Date(row.time),
                });
            }
        });

        return messages;
    }

    /**
     * Get messages before a specific timestamp (for lazy loading)
     * Used when user scrolls up and clicks "Show older messages"
     */
    async getMessagesBefore(
        networkUuid: string,
        channelName: string,
        beforeTime: number,
        limit: number
    ): Promise<Message[]> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return [];
        }

        const rows = await this.serialize_fetchall(
            "SELECT encrypted_data, time, type FROM messages WHERE network = ? AND channel = ? AND time < ? ORDER BY time DESC LIMIT ?",
            networkUuid,
            channelName.toLowerCase(),
            beforeTime,
            limit
        );

        // Decrypt messages (reverse to get chronological order)
        const messages = rows.reverse().map((row: any): Message => {
            try {
                const decrypted = this.decrypt(row.encrypted_data);
                const msg = JSON.parse(decrypted);
                msg.time = new Date(row.time);
                msg.type = row.type; // Restore type from column

                const newMsg = new Msg(msg);
                // ID will be assigned by caller (nextMessageId())

                return newMsg;
            } catch (error) {
                log.error(`Failed to decrypt message: ${error}`);
                // Return error message placeholder
                return new Msg({
                    type: MessageType.UNHANDLED,
                    text: "[Decryption failed]",
                    time: new Date(row.time),
                });
            }
        });

        return messages;
    }

    /**
     * Get count of unread messages (messages after lastReadTime)
     * Used for activity tracking
     */
    async getUnreadCount(
        networkUuid: string,
        channelName: string,
        lastReadTime: number
    ): Promise<number> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return 0;
        }

        const row = await this.serialize_get(
            "SELECT COUNT(*) as count FROM messages WHERE network = ? AND channel = ? AND time > ?",
            networkUuid,
            channelName.toLowerCase(),
            lastReadTime
        );

        return row ? (row.count as number) : 0;
    }

    /**
     * Get total message count for a channel
     * Used to determine if "Show older messages" button should be shown
     */
    async getMessageCount(networkUuid: string, channelName: string): Promise<number> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return 0;
        }

        const row = await this.serialize_get(
            "SELECT COUNT(*) as count FROM messages WHERE network = ? AND channel = ?",
            networkUuid,
            channelName.toLowerCase()
        );

        return (row?.count as number) || 0;
    }

    /**
     * Re-encrypt all messages with new encryption key
     * Used when user changes password
     */
    async reEncrypt(oldKey: Buffer, newKey: Buffer): Promise<void> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return;
        }

        log.info(`Re-encrypting messages for user ${this.userName}...`);

        // Fetch all encrypted messages
        const rows = await this.serialize_fetchall("SELECT id, encrypted_data FROM messages");

        await this.serialize_run("BEGIN TRANSACTION");

        try {
            for (const row of rows) {
                // Decrypt with old key
                const iv = row.encrypted_data.slice(0, 12);
                const tag = row.encrypted_data.slice(-16);
                const encrypted = row.encrypted_data.slice(12, -16);

                const decipher = crypto.createDecipheriv("aes-256-gcm", oldKey, iv);
                decipher.setAuthTag(tag);

                const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
                const plaintext = decrypted.toString("utf8");

                // Encrypt with new key
                const newIv = crypto.randomBytes(12);
                const cipher = crypto.createCipheriv("aes-256-gcm", newKey, newIv);

                const newEncrypted = Buffer.concat([
                    cipher.update(plaintext, "utf8"),
                    cipher.final(),
                ]);

                const newTag = cipher.getAuthTag();
                const newCiphertext = Buffer.concat([newIv, newEncrypted, newTag]);

                // Update database
                await this.serialize_run(
                    "UPDATE messages SET encrypted_data = ? WHERE id = ?",
                    newCiphertext,
                    row.id
                );
            }

            await this.serialize_run("COMMIT");

            // Update encryption key
            this.encryptionKey = newKey;
            this.cache.clear();

            log.info(`Re-encryption complete for user ${this.userName}`);
        } catch (error) {
            await this.serialize_run("ROLLBACK");
            throw error;
        }
    }

    /**
     * Save unread marker for a channel
     * Used to persist when user marks a channel as read
     */
    async saveUnreadMarker(
        networkUuid: string,
        channelName: string,
        lastReadTime: number
    ): Promise<void> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return;
        }

        await this.serialize_run(
            "INSERT OR REPLACE INTO unread_markers (network, channel, last_read_time) VALUES (?, ?, ?)",
            networkUuid,
            channelName.toLowerCase(),
            lastReadTime
        );
    }

    /**
     * Load all unread markers for all channels
     * Returns map of "network:channel" -> lastReadTime
     */
    async loadUnreadMarkers(): Promise<Map<string, number>> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return new Map();
        }

        const rows = await this.serialize_fetchall(
            "SELECT network, channel, last_read_time FROM unread_markers"
        );

        const markers = new Map<string, number>();

        for (const row of rows) {
            const key = `${row.network}:${row.channel}`;
            markers.set(key, row.last_read_time);
        }

        return markers;
    }

    /**
     * Load unread marker for a specific channel
     * Returns lastReadTime or undefined if not found
     */
    async loadUnreadMarker(networkUuid: string, channelName: string): Promise<number | undefined> {
        await this.initDone.promise;

        if (!this.isEnabled) {
            return undefined;
        }

        const row = await this.serialize_get(
            "SELECT last_read_time FROM unread_markers WHERE network = ? AND channel = ?",
            networkUuid,
            channelName.toLowerCase()
        );

        return row ? (row.last_read_time as number) : undefined;
    }
}

export default EncryptedMessageStorage;
