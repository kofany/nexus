# WeeChat Relay Bridge for nexuslounge

This bridge allows WeeChat Relay protocol clients (like Lith) to connect to nexuslounge and access erssi IRC through the WeeChat Relay protocol.

## Architecture

```
Lith Client (Qt/QML)
    |
    | WeeChat Relay Protocol (binary over WebSocket/TCP)
    |
    v
WeeChatRelayServer
    |
    | Commands/Events
    |
    v
WeeChatToErssiAdapter <---> ErssiToWeeChatAdapter
                                |
                                | erssi fe-web protocol (JSON over WebSocket)
                                |
                                v
                            IrssiClient
                                |
                                | WebSocket (TLS + AES-256-GCM)
                                |
                                v
                            erssi fe-web module
```

## Components

### 1. weechatProtocol.ts
Binary protocol encoder/decoder for WeeChat Relay protocol.

**Supported data types:**
- `chr` - char (1 byte)
- `int` - integer (4 bytes, big endian)
- `lon` - long integer (variable length string)
- `str` - string (4 bytes length + UTF-8 data)
- `buf` - buffer (4 bytes length + binary data)
- `ptr` - pointer (variable length hex string)
- `tim` - time (variable length string)
- `htb` - hashtable (key/value pairs)
- `hda` - hdata (structured data with multiple objects)
- `arr` - array (typed array of values)

**Compression:**
- Supports zlib compression (WeeChat Relay standard)

### 2. weechatHData.ts
Helper functions for building HData structures (most complex WeeChat data type).

**Features:**
- Build HData with multiple fields and objects
- Generate consistent pointers from strings
- Color code conversion (mIRC <-> WeeChat)

### 3. weechatRelayServer.ts
Main server that accepts TCP and WebSocket connections from WeeChat clients.

**Features:**
- TCP server on configurable port
- WebSocket server on configurable port
- Per-client connection management
- Event forwarding to adapters

### 4. weechatRelayClient.ts
Handles individual client connections.

**Features:**
- Handshake negotiation (password hash algorithm, compression)
- Authentication (plain, sha256, sha512, pbkdf2+sha256, pbkdf2+sha512)
- Command parsing and routing
- Binary message sending

### 5. erssiToWeechatAdapter.ts
Translates erssi fe-web events to WeeChat Relay protocol.

**Mappings:**
- erssi network → WeeChat buffer (type: server)
- erssi channel → WeeChat buffer (type: channel)
- erssi query → WeeChat buffer (type: private)
- erssi message → WeeChat line_data
- erssi user → WeeChat nicklist item

**Events:**
- `buffer:opened` - New buffer created
- `buffer:closed` - Buffer closed
- `line:added` - New message in buffer
- `nicklist:changed` - Nicklist updated

### 6. weechatToErssiAdapter.ts
Translates WeeChat Relay commands to erssi actions.

**Commands:**
- `handshake` - Negotiate protocol features
- `init` - Authenticate user
- `hdata buffer:gui_buffers(*)` - Get all buffers
- `hdata buffer:0xXXX/lines/last_line(-N)/data` - Get message history
- `input 0xXXX text` - Send message or command
- `sync * buffer,nicklist` - Subscribe to updates
- `desync * buffer` - Unsubscribe from updates
- `nicklist 0xXXX` - Get nicklist for buffer
- `info version` - Get version info
- `ping` - Ping/pong

### 7. weechatBridge.ts
Main bridge coordinator that connects everything together.

**Features:**
- Manages WeeChat Relay server lifecycle
- Creates adapters per authenticated client
- Maps WeeChat users to IrssiClient instances
- Handles client disconnections

## Configuration

Add to `config.js`:

```javascript
weechatRelay: {
    enabled: true,
    tcpPort: 9001,
    tcpHost: "127.0.0.1",
    wsPort: 9002,
    wsHost: "127.0.0.1",
    wsPath: "/weechat",
    password: "",  // Leave empty to use The Lounge password
    passwordHashAlgo: ["plain", "sha256", "sha512", "pbkdf2+sha256", "pbkdf2+sha512"],
    passwordHashIterations: 100000,
    compression: true,
}
```

## Usage with Lith

1. Enable the bridge in nexuslounge config
2. Start nexuslounge
3. Configure Lith:
   - Host: nexuslounge server address
   - Port: 9002 (WebSocket) or 9001 (TCP)
   - Use WebSocket: Yes (recommended)
   - Use SSL: Yes (if nexuslounge uses HTTPS)
   - Password: Your nexuslounge user password
4. Connect!

## Protocol Flow

1. **Connection**: Lith connects via WebSocket/TCP
2. **Handshake** (optional): Negotiate password hash algorithm and compression
3. **Init**: Authenticate with password (plain or hashed)
4. **Initial sync**: Lith requests buffers, lines, nicklist
5. **Subscribe**: Lith subscribes to buffer updates
6. **Live updates**: Bridge forwards erssi events to Lith in real-time
7. **User input**: Lith sends messages/commands, bridge forwards to erssi

## Testing

Connect with Lith:
```
Host: 127.0.0.1
Port: 9002
WebSocket: Yes
Path: /weechat
Password: your_password
```

Or test with raw WebSocket:
```javascript
const ws = new WebSocket('ws://127.0.0.1:9002/weechat');
ws.binaryType = 'arraybuffer';
// Send handshake, init, hdata commands...
```

