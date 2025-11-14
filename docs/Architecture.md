# Architecture Documentation

This document provides a comprehensive overview of NexusIRC's architecture, design decisions, and implementation details.

## Table of Contents

- [System Overview](#system-overview)
- [Core Components](#core-components)
- [Protocol Layer](#protocol-layer)
- [Storage Architecture](#storage-architecture)
- [Client-Server Communication](#client-server-communication)
- [Security Architecture](#security-architecture)
- [Message Flow](#message-flow)
- [Extension Points](#extension-points)

---

## System Overview

NexusIRC is built as a **web frontend for irssi/erssi**. It does NOT connect directly to IRC networks - all IRC connectivity is handled exclusively by irssi/erssi via the FE-Web protocol.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│                   (Web Browsers / Mobile)                        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Vue 3 UI   │  │  Socket.IO   │  │   Router     │         │
│  │  Components  │  │   Client     │  │  (Vue Router)│         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└────────────────────────────┬────────────────────────────────────┘
                             │ WebSocket (Socket.IO)
                             │ JSON over Binary Frames
┌────────────────────────────▼────────────────────────────────────┐
│                        Server Layer                              │
│                      (Node.js / TypeScript)                      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Express HTTP Server                         │   │
│  │  • Static file serving                                  │   │
│  │  • REST API endpoints                                   │   │
│  │  • WebSocket upgrade handling                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Socket.IO Server                            │   │
│  │  • Real-time bidirectional communication                │   │
│  │  • Event-based messaging                                │   │
│  │  • Session management                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Client Manager                              │   │
│  │  • Multi-user support                                   │   │
│  │  • Session state management                             │   │
│  │  • User authentication                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Protocol Adapters                           │   │
│  │  ┌──────────────┐  ┌──────────────┐                     │   │
│  │  │    irssi     │  │   WeeChat    │                     │   │
│  │  │  FE-Web      │  │    Relay     │                     │   │
│  │  │  (REQUIRED)  │  │  (Optional)  │                     │   │
│  │  └──────────────┘  └──────────────┘                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Storage Layer                               │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │    SQLite    │  │  Text Files  │  │   Uploads    │  │   │
│  │  │  (Messages)  │  │   (Logs)     │  │   (Files)    │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │ FE-Web Protocol (WebSocket)
                             │ AES-256-GCM Encrypted
┌────────────────────────────▼────────────────────────────────────┐
│                  irssi/erssi Instance                            │
│  • Handles ALL IRC connectivity (REQUIRED)                      │
│  • Manages networks, channels, users                            │
│  • Executes IRC commands                                        │
│  • fe-web module provides WebSocket interface                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ Native IRC Protocol
                             ▼
                   ┌────────────────────┐
                   │   IRC Networks     │
                   │  (Libera, OFTC...) │
                   └────────────────────┘
```

**Critical:** NexusIRC has NO built-in IRC client. All IRC functionality comes from irssi/erssi.

---

## Core Components

### 1. Client Manager (`server/clientManager.ts`)

**Responsibility:** Manages all user instances and their lifecycle.

**Key Features:**
- User authentication and session management
- Client instantiation and cleanup
- Multi-session support (same user, multiple browsers)
- User configuration loading and saving

**Code Structure:**
```typescript
class ClientManager {
    clients: Map<string, Client>
    
    loginUser(username: string, password: string): Client
    logoutUser(username: string): void
    attachBrowserSession(username: string, socket: Socket): void
    detachBrowserSession(username: string, socketId: string): void
}
```

### 2. IRC Client (`server/irssiClient.ts`)

**Responsibility:** Manages IRC connections, either directly or through protocol adapters.

**Key Features:**
- Network connection management
- Channel state tracking
- Message routing
- Command execution
- Event emission to connected browsers

**Architecture:**
```typescript
class IrssiClient {
    networks: Map<string, Network>
    messageStorage: MessageStorage
    attachedBrowsers: Map<string, Socket>
    
    connect(network: NetworkConfig): Promise<void>
    disconnect(networkId: string): void
    sendMessage(target: string, text: string): void
    handleIncomingMessage(message: Message): void
}
```

### 3. Network (`server/models/network.ts`)

**Responsibility:** Represents a single IRC network connection.

**Key Features:**
- IRC protocol implementation
- Connection state machine
- Channel management
- User list tracking
- Automatic reconnection

### 4. Channel (`server/models/chan.ts`)

**Responsibility:** Represents a channel or private message conversation.

**Key Features:**
- Message history
- User list
- Topic management
- Unread message counter
- Mention tracking

---

## Protocol Layer

### irssi FE-Web Protocol

Located in `server/feWebClient/`, this implements the irssi FE-Web protocol specification.

**Components:**

#### 1. FeWebSocket (`feWebSocket.ts`)
- WebSocket client for irssi fe-web module
- Binary frame handling
- Auto-reconnection with exponential backoff
- Event-based message routing

#### 2. FeWebEncryption (`feWebEncryption.ts`)
- AES-256-GCM encryption/decryption
- PBKDF2 key derivation
- Dual-layer security (TLS + AES)

**Message Flow:**
```
Browser → NexusIRC: User command
    ↓
NexusIRC → irssi: Encrypted binary frame
    [IV 12B][Encrypted Command][Auth Tag 16B]
    ↓
irssi: Process command, generate events
    ↓
irssi → NexusIRC: Encrypted binary frames
    [IV 12B][Encrypted JSON][Auth Tag 16B]
    ↓
NexusIRC: Decrypt, parse, store
    ↓
NexusIRC → All Browsers: Real-time update
```

**Encryption Architecture:**

```javascript
// Triple-Key System
1. Authentication Key (bcrypt): Verify login to NexusIRC
2. WebSocket Key (PBKDF2): irssi protocol encryption
3. Storage Key (PBKDF2): Local message storage encryption

// Key Derivation
webSocketKey = PBKDF2(
    irssiPassword,
    salt: "irssi-fe-web-v1",  // FIXED salt
    iterations: 10000,
    keyLength: 32,
    digest: "sha256"
)

storageKey = PBKDF2(
    userPassword,
    salt: irssiPassword,  // Variable salt
    iterations: 10000,
    keyLength: 32,
    digest: "sha256"
)
```

### WeeChat Relay Protocol

Located in `server/weechatRelay/`, implements WeeChat relay protocol.

**Features:**
- Binary protocol support
- Compression support (zlib, zstd)
- Multiple client connections
- Protocol versioning

---

## Storage Architecture

### Message Storage

NexusIRC supports pluggable storage backends:

#### 1. SQLite Storage (`server/plugins/messageStorage/sqlite.ts`)

**Schema:**
```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    network TEXT NOT NULL,
    channel TEXT NOT NULL,
    time INTEGER NOT NULL,
    encrypted_data BLOB NOT NULL
);

CREATE INDEX idx_messages_user_channel 
    ON messages(user, network, channel, time);
```

**Features:**
- Full-text search
- Message cleanup policy
- Encrypted message storage
- Efficient pagination
- Automatic migrations

**Encryption Format:**
```
Message on disk:
[IV 12 bytes][Ciphertext (variable)][Auth Tag 16 bytes]

Decrypted JSON:
{
    "type": "message",
    "from_nick": "alice",
    "text": "Hello world",
    "timestamp": 1706198400,
    "hostmask": "alice@example.com"
}
```

#### 2. Text Storage (`server/plugins/messageStorage/text.ts`)

**Features:**
- Plain text log files
- One file per channel
- Simple grep-based search
- No dependencies

**File Structure:**
```
~/.nexusirc/logs/
    username/
        network_name/
            #channel.log
            nick.log
```

### User Configuration Storage

Stored as JSON files in `~/.nexusirc/users/`:

```json
{
    "password": "$2a$11$...",  // bcrypt hash
    "log": true,
    "awayMessage": "Away",
    "networks": [
        {
            "uuid": "unique-id",
            "name": "Libera",
            "host": "irc.libera.chat",
            "port": 6697,
            "tls": true,
            "nick": "username",
            "channels": ["#nexusirc"]
        }
    ],
    "irssiConnection": {
        "host": "127.0.0.1",
        "port": 9001,
        "passwordEncrypted": "..."
    }
}
```

---

## Client-Server Communication

### Socket.IO Events

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `auth:perform` | `{username, password}` | Authenticate user |
| `input` | `{target, text}` | Send message/command |
| `more` | `{target, lastId}` | Request message history |
| `network:new` | `{...networkConfig}` | Add new network |
| `network:edit` | `{uuid, ...config}` | Edit network config |
| `open` | `{target}` | Open channel/query |
| `sort` | `{type, order, target}` | Sort channels |
| `names` | `{target}` | Request user list |
| `changelog` | `{}` | Request changelog |
| `search` | `{query, offset}` | Search messages |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `auth:success` | `{...user}` | Authentication successful |
| `auth:failed` | `{}` | Authentication failed |
| `init` | `{networks, active}` | Initial state |
| `msg` | `{chan, msg}` | New message |
| `more` | `{chan, messages}` | Message history |
| `network` | `{network}` | Network added/updated |
| `network:status` | `{network, connected}` | Connection status |
| `nick` | `{network, nick}` | Nick changed |
| `join` | `{chan}` | Channel joined |
| `part` | `{chan}` | Channel parted |
| `quit` | `{network, user}` | User quit |
| `names` | `{chan, users}` | User list |
| `topic` | `{chan, topic}` | Topic changed |
| `users` | `{chan, users}` | User list update |
| `configuration` | `{...config}` | Server configuration |

### REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve web application |
| `GET` | `/storage/:file` | Serve uploaded files |
| `POST` | `/upload` | Upload file |
| `GET` | `/packages` | List installed packages |
| `GET` | `/packages/search/:query` | Search packages |
| `POST` | `/packages/install` | Install package |
| `DELETE` | `/packages/:name` | Uninstall package |

---

## Security Architecture

### Authentication Flow

```
1. User enters credentials in browser
2. Client sends Socket.IO event: auth:perform {username, password}
3. Server verifies bcrypt hash
4. Server derives encryption keys:
   - Decrypt irssi password from storage
   - Derive storage encryption key
5. Server loads user configuration
6. Server initializes message storage with encryption key
7. Server connects to irssi/IRC if configured
8. Server sends auth:success with user data
9. Browser receives initial state
```

### Encryption Keys

**Password Storage:**
```javascript
// User password (hashed with bcrypt)
bcrypt.hash(password, 11) → stored in users/username.json

// irssi password (encrypted with temporary key)
tempKey = PBKDF2(userPassword, "thelounge_irssi_temp_salt", ...)
encrypted = AES-256-GCM(irssiPassword, tempKey)
```

**Runtime Keys:**
```javascript
// WebSocket encryption (managed by FeWebSocket)
webSocketKey = PBKDF2(irssiPassword, "irssi-fe-web-v1", ...)

// Message storage encryption (managed by EncryptedMessageStorage)
storageKey = PBKDF2(userPassword, irssiPassword, ...)
```

### Security Considerations

**Strengths:**
- ✅ Passwords hashed with bcrypt
- ✅ Messages encrypted at rest (AES-256-GCM)
- ✅ TLS support for network connections
- ✅ Encryption keys derived from user password
- ✅ Each user has isolated encryption key

**Limitations:**
- ⚠️ Encryption keys stored in RAM during runtime
- ⚠️ Admin with root access can dump memory
- ⚠️ Requires trust in server administrator

**Mitigations:**
- Run in isolated environment (Docker, VM)
- Use encrypted swap (Linux: dm-crypt)
- Regular server restarts to clear memory
- Strong passwords (minimum 16 characters)
- Enable HTTPS for web interface

---

## Message Flow

### Sending a Message

```
1. User types message in browser, presses Enter
2. Browser emits Socket.IO event: 
   input {target: channelId, text: "/msg #channel Hello"}

3. Server receives event, finds user's Client instance

4. Server parses command, determines target

5A. Direct IRC mode:
    → Server calls network.sendMessage()
    → IRC library formats PRIVMSG
    → Sent to IRC server over TCP

5B. irssi FE-Web mode:
    → Server calls irssiConnection.executeCommand()
    → Command encrypted with AES-256-GCM
    → Sent to irssi over WebSocket

6. Message echoed back from IRC/irssi

7. Server receives message event

8. Server encrypts and saves to storage:
   messageStorage.saveMessage()

9. Server broadcasts to all attached browsers:
   for (socket of attachedBrowsers) {
       socket.emit("msg", {chan, msg})
   }

10. All browsers receive and display message
```

### Receiving a Message

```
1. IRC server sends PRIVMSG to client
   OR
   irssi sends encrypted message event

2. Server decrypts (if encrypted)

3. Server parses message, determines target channel

4. Server checks for mentions, highlights

5. Server encrypts and saves to storage

6. Server emits to all connected browsers:
   socket.emit("msg", {
       chan: channelId,
       msg: {
           id: messageId,
           type: "message",
           from: {nick: "alice"},
           text: "Hello world",
           time: new Date(),
           highlight: false
       }
   })

7. Browsers update UI, show notification if needed
```

---

## Extension Points

### Plugin System

Located in `server/plugins/`, supports custom functionality:

**Available Plugin Types:**
- Authentication providers (`plugins/auth/`)
- Message storage backends (`plugins/messageStorage/`)
- Input handlers
- Theme packages

**Example Plugin Structure:**
```javascript
export default {
    name: "custom-plugin",
    version: "1.0.0",
    
    onServerStart(context) {
        // Initialize plugin
    },
    
    onClientConnect(client) {
        // Handle new client
    },
    
    onMessage(client, message) {
        // Process message
    }
}
```

### Custom Themes

Themes are Vue components with CSS:

```
nexusirc-theme-custom/
    package.json
    theme.css
    client.js (optional)
```

### Custom Commands

Add custom IRC commands:

```javascript
// server/plugins/custom-commands.ts
export default {
    name: "customCommands",
    
    commands: {
        "hello": function(client, target, params) {
            client.sendMessage(target, `Hello ${params}!`);
        }
    }
}
```

---

## Performance Considerations

### Message History Optimization

- **In-Memory LRU Cache**: Recent messages cached for instant access
- **Lazy Loading**: Only load messages when requested
- **Pagination**: Load 100 messages at a time
- **SQLite Indices**: Optimized for user/channel/time queries

### Connection Pooling

- **Per-User Persistent Connections**: One IRC connection per user
- **Multi-Session Support**: Multiple browsers share same connection
- **Automatic Reconnection**: Exponential backoff for failed connections

### Memory Management

- **maxHistory Limit**: Configurable limit on in-memory messages
- **Storage Cleanup Policy**: Automatic removal of old messages
- **Browser Connection Tracking**: Clean up on disconnect

---

## Development Architecture

### TypeScript Structure

```
server/
    ├── clientManager.ts     # User management
    ├── irssiClient.ts       # IRC client
    ├── server.ts            # Express + Socket.IO server
    ├── models/              # Data models
    │   ├── network.ts
    │   ├── chan.ts
    │   └── msg.ts
    ├── plugins/             # Plugin system
    ├── feWebClient/         # irssi protocol
    ├── weechatRelay/        # WeeChat protocol
    └── command-line/        # CLI commands

client/
    ├── js/                  # Vue 3 application
    │   ├── store.ts         # Vuex state management
    │   ├── router.ts        # Vue Router
    │   └── socket.ts        # Socket.IO client
    └── components/          # Vue components
        ├── Chat.vue
        ├── MessageList.vue
        └── ...
```

### Build Process

1. **Server Build**: TypeScript → JavaScript (dist/server/)
2. **Client Build**: Vue SFC + TS → Bundled JS (public/js/)
3. **CSS Build**: PostCSS → Minified CSS (public/css/)
4. **Asset Copy**: Fonts, images → public/

---

## Future Architecture Plans

- [ ] Redis support for multi-server deployments
- [ ] GraphQL API for better client integration
- [ ] WebRTC for peer-to-peer features
- [ ] Service Worker for offline support
- [ ] Native mobile app using same backend

---

[← Back to README](../README.md)
