# WeeChat Relay Bridge for nexuslounge

This bridge allows WeeChat Relay protocol clients (like Lith) to connect to nexuslounge and access erssi IRC through the WeeChat Relay protocol.

**Per-User Architecture:** Each user has their own WeeChat Relay server on a unique port, just like each user has their own erssi connection.

## Architecture

```
User 1:
  Lith Client → WeeChatRelayServer (port 9001) → IrssiClient → erssi
  Vue Browser → Socket.io → IrssiClient → erssi

User 2:
  Lith Client → WeeChatRelayServer (port 9002) → IrssiClient → erssi
  Vue Browser → Socket.io → IrssiClient → erssi

User 3:
  Lith Client → WeeChatRelayServer (port 9003) → IrssiClient → erssi
  Vue Browser → Socket.io → IrssiClient → erssi
```

Each user can use:

- Multiple Vue browsers (already working)
- Multiple Lith clients (new!)
- Both at the same time!

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

## Configuration (Per-User)

Configuration is stored in each user's `user.json` file:

```json
{
  "log": true,
  "password": "bcrypt_hash",
  "irssiConnection": {
    "host": "91.121.226.216",
    "port": 9111,
    "passwordEncrypted": "...",
    "encryption": true,
    "useTLS": true,
    "rejectUnauthorized": false
  },
  "weechatRelay": {
    "enabled": true,
    "port": 9001,
    "passwordEncrypted": "...",
    "compression": true
  }
}
```

**Configuration via UI:**

- Go to Settings → WeeChat Relay (next to Irssi Connection)
- Enable WeeChat Relay
- Set unique port (e.g., 9001, 9002, 9003...)
- Set password
- Save

**Password encryption:**

- Password is encrypted using the same method as irssiConnection
- Stored as `passwordEncrypted` in user.json
- Decrypted in memory when user logs in

## Usage with Lith

1. **Configure in nexuslounge UI:**

   - Login to nexuslounge web interface
   - Go to Settings → WeeChat Relay
   - Enable: Yes
   - Port: Choose unique port (e.g., 9001)
   - Password: Set a password for Lith
   - Save

2. **Configure Lith:**

   - Host: Your nexuslounge server address
   - Port: The port you configured (e.g., 9001)
   - Use WebSocket: Yes
   - Path: /weechat
   - Use SSL: Yes (if nexuslounge uses HTTPS)
   - Password: The password you set in step 1

3. **Connect!**
   - Lith will connect to your personal WeeChat Relay server
   - You'll see all your erssi networks, channels, and messages
   - You can use Lith and Vue browser at the same time!

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
const ws = new WebSocket("ws://127.0.0.1:9002/weechat");
ws.binaryType = "arraybuffer";
// Send handshake, init, hdata commands...
```
