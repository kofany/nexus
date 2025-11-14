# API Reference

NexusIRC provides both REST API endpoints and Socket.IO events for interaction with the server.

## Table of Contents

- [REST API](#rest-api)
- [Socket.IO Events](#socketio-events)
- [Plugin API](#plugin-api)
- [Data Structures](#data-structures)

---

## REST API

### Base URL

```
http://localhost:19000/
```

All API endpoints are relative to this base URL.

### Authentication

Most REST endpoints require session authentication via cookies set during Socket.IO authentication.

---

### Endpoints

#### `GET /`

Serves the main web application.

**Response:** HTML page

---

#### `GET /storage/:file`

Retrieve uploaded files.

**Parameters:**
- `file` (string): Filename to retrieve

**Response:** File binary data

**Example:**
```
GET /storage/image-abc123.png
```

---

#### `POST /upload`

Upload a file to the server.

**Headers:**
- `Content-Type: multipart/form-data`

**Body:** File data

**Response:**
```json
{
    "url": "https://example.com/storage/file-abc123.ext",
    "name": "file.ext"
}
```

**Example:**
```bash
curl -X POST http://localhost:19000/upload \
  -F "file=@image.png" \
  -H "Cookie: connect.sid=..."
```

---

#### `GET /packages`

List installed packages (themes and plugins).

**Response:**
```json
{
    "packages": [
        {
            "name": "nexusirc-theme-solarized",
            "version": "1.0.0",
            "type": "theme"
        }
    ]
}
```

---

#### `GET /packages/search/:query`

Search for available packages on npm.

**Parameters:**
- `query` (string): Search query

**Response:**
```json
{
    "results": [
        {
            "name": "nexusirc-theme-custom",
            "version": "1.2.3",
            "description": "Custom theme for NexusIRC"
        }
    ]
}
```

---

#### `POST /packages/install`

Install a package.

**Body:**
```json
{
    "package": "nexusirc-theme-solarized"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Package installed successfully"
}
```

---

#### `DELETE /packages/:name`

Uninstall a package.

**Parameters:**
- `name` (string): Package name

**Response:**
```json
{
    "success": true,
    "message": "Package uninstalled successfully"
}
```

---

## Socket.IO Events

### Client → Server Events

#### `auth:perform`

Authenticate a user.

**Payload:**
```javascript
{
    username: "alice",
    password: "secret123"
}
```

**Response Events:**
- `auth:success` - Authentication successful
- `auth:failed` - Authentication failed

---

#### `input`

Send a message or command.

**Payload:**
```javascript
{
    target: 42,  // Channel ID
    text: "Hello world"
}
```

---

#### `more`

Request message history.

**Payload:**
```javascript
{
    target: 42,     // Channel ID
    lastId: 1000    // Last message ID received
}
```

**Response Event:** `more`

---

#### `open`

Open a channel or query.

**Payload:**
```javascript
{
    target: 42  // Channel ID
}
```

---

#### `names`

Request user list for a channel.

**Payload:**
```javascript
{
    target: 42  // Channel ID
}
```

**Response Event:** `names`

---

#### `changelog`

Request the changelog.

**Response Event:** `changelog`

---

#### `search`

Search messages.

**Payload:**
```javascript
{
    networkUuid: "network-uuid",
    channelName: "#nexusirc",
    query: "search term",
    offset: 0
}
```

**Response Event:** `search:results`

---

#### `network:new`

Add a new IRC network.

**Payload:**
```javascript
{
    name: "Libera",
    host: "irc.libera.chat",
    port: 6697,
    tls: true,
    nick: "myusername",
    username: "myusername",
    realname: "My Real Name",
    password: "",
    join: "#nexusirc"
}
```

---

#### `network:edit`

Edit an existing network.

**Payload:**
```javascript
{
    uuid: "network-uuid",
    name: "Libera",
    // ... other network properties
}
```

---

#### `sort`

Sort channels or networks.

**Payload:**
```javascript
{
    type: "channels",
    order: [42, 43, 44],
    target: 10  // Network ID
}
```

---

### Server → Client Events

#### `auth:success`

Sent when authentication succeeds.

**Payload:**
```javascript
{
    success: true,
    user: {
        name: "alice",
        log: true,
        awayMessage: ""
    }
}
```

---

#### `auth:failed`

Sent when authentication fails.

**Payload:**
```javascript
{
    success: false
}
```

---

#### `init`

Sends initial state after authentication.

**Payload:**
```javascript
{
    active: -1,
    networks: [
        {
            uuid: "network-uuid",
            name: "Libera",
            host: "irc.libera.chat",
            status: {
                connected: true,
                secure: true
            },
            channels: [
                {
                    id: 42,
                    name: "#nexusirc",
                    type: "channel",
                    unread: 5,
                    highlight: 0,
                    messages: [],
                    users: []
                }
            ]
        }
    ],
    token: "auth-token"
}
```

---

#### `msg`

New message received.

**Payload:**
```javascript
{
    chan: 42,  // Channel ID
    msg: {
        id: 12345,
        type: "message",
        time: "2024-01-15T10:30:00.000Z",
        from: {
            nick: "bob",
            mode: "@"
        },
        text: "Hello world",
        self: false,
        highlight: false
    },
    unread: 1
}
```

---

#### `more`

Message history response.

**Payload:**
```javascript
{
    chan: 42,
    messages: [
        // Array of message objects
    ],
    totalMessages: 1000
}
```

---

#### `network`

Network added or updated.

**Payload:**
```javascript
{
    network: {
        uuid: "network-uuid",
        name: "Libera",
        // ... network properties
    }
}
```

---

#### `network:status`

Network connection status changed.

**Payload:**
```javascript
{
    network: "network-uuid",
    connected: true,
    secure: true
}
```

---

#### `join`

Channel joined.

**Payload:**
```javascript
{
    network: "network-uuid",
    chan: {
        id: 42,
        name: "#nexusirc",
        type: "channel"
    }
}
```

---

#### `part`

Channel parted.

**Payload:**
```javascript
{
    chan: 42
}
```

---

#### `nick`

Nick changed.

**Payload:**
```javascript
{
    network: "network-uuid",
    nick: "new-nick"
}
```

---

#### `quit`

User quit.

**Payload:**
```javascript
{
    network: "network-uuid",
    user: {
        nick: "bob",
        channels: [42, 43]
    }
}
```

---

#### `users`

User list update.

**Payload:**
```javascript
{
    chan: 42,
    users: [
        {
            nick: "alice",
            mode: "@"
        },
        {
            nick: "bob",
            mode: "+"
        }
    ]
}
```

---

#### `names`

Full user list for a channel.

**Payload:**
```javascript
{
    chan: 42,
    users: [
        // Array of user objects
    ]
}
```

---

#### `topic`

Topic changed.

**Payload:**
```javascript
{
    chan: 42,
    topic: "Welcome to #nexusirc"
}
```

---

#### `changelog`

Server changelog.

**Payload:**
```javascript
{
    changelog: "# Changelog\n\n## v4.4.3\n..."
}
```

---

#### `search:results`

Search results.

**Payload:**
```javascript
{
    networkUuid: "network-uuid",
    channelName: "#nexusirc",
    results: [
        {
            id: 12345,
            time: "2024-01-15T10:30:00.000Z",
            text: "search term found here",
            from: { nick: "alice" }
        }
    ]
}
```

---

## Plugin API

Plugins can extend NexusIRC functionality.

### Package Structure

```
nexusirc-plugin-example/
├── package.json
├── index.js
└── README.md
```

### package.json

```json
{
    "name": "nexusirc-plugin-example",
    "version": "1.0.0",
    "nexusirc": {
        "supports": ">=4.4.0"
    },
    "main": "index.js"
}
```

### Plugin Entry Point

```javascript
// index.js
export default {
    onServerStart(api) {
        // Called when NexusIRC starts
        
        // Access configuration
        const config = api.Config.getConfig();
        
        // Add stylesheet
        api.Stylesheets.addFile("style.css");
        
        // Add public file
        api.PublicFiles.add("script.js");
        
        // Logging
        api.Logger.info("Plugin loaded");
    }
};
```

### Available APIs

#### Config

```javascript
api.Config.getConfig()  // Get server configuration
api.Config.getPersistentStorageDir()  // Get plugin storage directory
```

#### Stylesheets

```javascript
api.Stylesheets.addFile("style.css")  // Add CSS file
```

#### PublicFiles

```javascript
api.PublicFiles.add("script.js")  // Add public JavaScript file
```

#### Logger

```javascript
api.Logger.error("Error message")
api.Logger.warn("Warning message")
api.Logger.info("Info message")
api.Logger.debug("Debug message")
```

---

## Data Structures

### Network

```typescript
interface Network {
    uuid: string;
    name: string;
    host: string;
    port: number;
    tls: boolean;
    rejectUnauthorized: boolean;
    nick: string;
    username: string;
    realname: string;
    password: string;
    join: string;
    channels: Channel[];
    status: {
        connected: boolean;
        secure: boolean;
    };
}
```

### Channel

```typescript
interface Channel {
    id: number;
    name: string;
    type: "channel" | "query" | "lobby" | "special";
    topic: string;
    unread: number;
    highlight: number;
    messages: Message[];
    users: User[];
}
```

### Message

```typescript
interface Message {
    id: number;
    type: "message" | "action" | "notice" | "join" | "part" | "quit" | "nick" | "topic" | "mode" | "ctcp" | "away" | "back";
    time: string;  // ISO 8601
    from: {
        nick: string;
        mode: string;
    };
    text: string;
    self: boolean;
    highlight: boolean;
    hostmask?: string;
}
```

### User

```typescript
interface User {
    nick: string;
    mode: string;  // "@", "+", "", etc.
    away: boolean;
    hostmask?: string;
}
```

---

[← Back to README](../README.md)
