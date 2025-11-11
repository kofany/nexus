import type {Database} from "sqlite3";

import {Channel} from "../../models/chan.js";
import {Message} from "../../models/msg.js";
import {Network} from "../../models/network.js";
import Client from "../../client.js";
import {SearchQuery, SearchResponse} from "../../../shared/types/storage.js";
import type {MessageType} from "../../../shared/types/msg.js";

export type DeletionRequest = {
    olderThanDays: number;
    messageTypes: MessageType[] | null; // null means no restriction
    limit: number; // -1 means unlimited
};

interface MessageStorage {
    isEnabled: boolean;

    enable(): Promise<void>;

    close(): Promise<void>;

    index(network: Network, channel: Channel, msg: Message): Promise<void>;

    deleteChannel(network: Network, channel: Channel): Promise<void>;

    getMessages(network: Network, channel: Channel, nextID: () => number): Promise<Message[]>;

    /**
     * Get last N messages for a channel (for initial load)
     * Used by irssi proxy mode to load messages when browser connects
     */
    getLastMessages(networkUuid: string, channelName: string, limit: number): Promise<Message[]>;

    /**
     * Get messages before a specific timestamp (for lazy loading)
     * Used when user scrolls up and clicks "Show older messages"
     */
    getMessagesBefore(
        networkUuid: string,
        channelName: string,
        beforeTime: number,
        limit: number
    ): Promise<Message[]>;

    /**
     * Get total message count for a channel
     */
    getMessageCount(networkUuid: string, channelName: string): Promise<number>;

    canProvideMessages(): boolean;
}

type SearchFunction = (query: SearchQuery) => Promise<SearchResponse>;

export interface SearchableMessageStorage extends MessageStorage {
    search: SearchFunction;
}
