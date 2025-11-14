# WeeChat Relay Guide

This guide explains how to configure and use the WeeChat relay server built into NexusIRC.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Client Connection](#client-connection)
- [Protocol Details](#protocol-details)
- [Troubleshooting](#troubleshooting)

---

## Overview

NexusIRC includes a **WeeChat relay server** that allows WeeChat relay-compatible clients to connect and access IRC channels through NexusIRC. This enables both the NexusIRC web interface and external WeeChat relay clients to coexist.

### Benefits

- ✅ Use native WeeChat clients alongside the web interface
- ✅ Mobile apps that support WeeChat relay protocol
- ✅ Terminal UI enthusiasts can use weechat-android, Glowing Bear, etc.
- ✅ Share IRC connection state across all clients

### Compatible Clients

- [WeeChat](https://weechat.org/) (official relay protocol)
- [Glowing Bear](https://github.com/glowing-bear/glowing-bear) (web client)
- [weechat-android](https://github.com/ubergeek42/weechat-android) (Android)
- Any client supporting WeeChat relay protocol

---

## Prerequisites

- NexusIRC installed and running
- User account created (private mode)
- IRC networks configured

---

## Configuration

### Server Configuration

Edit `~/.nexusirc/config.js`:

```javascript
export default {
  // ... other settings ...
  weechat: {
    enable: true,
    host: "0.0.0.0", // Listen on all interfaces
    port: 9000, // WeeChat relay default port
    ssl: false, // TLS encryption
    password: "relay-password", // Required for authentication
    bindAddress: undefined, // Optional bind address
  },
};
```

### SSL/TLS Configuration (Recommended)

For encrypted connections:

```javascript
weechat: {
    enable: true,
    host: "0.0.0.0",
    port: 9001,
    ssl: true,
    sslCert: "/path/to/cert.pem",
    sslKey: "/path/to/key.pem",
    password: "relay-password"
}
```

Generate self-signed certificates:

```bash
openssl req -new -x509 -days 365 -nodes \
    -out ~/.nexusirc/weechat-cert.pem \
    -keyout ~/.nexusirc/weechat-key.pem
```

### Starting the Relay Server

```bash
# Restart NexusIRC to apply changes
nexusirc restart
```

Check logs to confirm the relay server started:

```bash
tail -f ~/.nexusirc/logs/server.log
```

Expected output:

```
[INFO] WeeChat relay server listening on 0.0.0.0:9000
```

---

## Client Connection

### Glowing Bear (Web Client)

1. Navigate to https://www.glowing-bear.org/
2. Click **Settings** (gear icon)
3. Configure connection:
   - **Host**: `your-server-ip` or `localhost`
   - **Port**: `9000` (or configured port)
   - **Password**: `relay-password`
   - **SSL**: Check if using SSL
4. Click **Connect**

### WeeChat (Official Client)

Configure relay in WeeChat:

```bash
# Add remote relay
/relay add weechat 9000

# Set password
/set relay.network.password relay-password

# Enable SSL (optional)
/set relay.network.ssl on

# Connect from another WeeChat instance
/server add nexusirc_relay localhost/9000 -password=relay-password
/connect nexusirc_relay
```

### weechat-android (Mobile)

1. Open **weechat-android** app
2. Tap **Add Connection**
3. Configure:
   - **Connection name**: `NexusIRC`
   - **Relay host**: `your-server-ip`
   - **Relay port**: `9000`
   - **Password**: `relay-password`
   - **SSL**: Enable if configured
4. Tap **Connect**

---

## Protocol Details

### WeeChat Relay Protocol

The WeeChat relay protocol is a binary protocol for communication between WeeChat and relay clients.

#### Message Format

```
┌────────────┬───────────┬────────────┬──────────────┐
│ Length (4B)│ Compression│ ID (string)│ Data (various)│
└────────────┴───────────┴────────────┴──────────────┘
```

- **Length**: Total message length (4 bytes, big-endian)
- **Compression**: Compression type (1 byte)
  - `0x00`: No compression
  - `0x01`: zlib
  - `0x02`: zstd
- **ID**: Message identifier (null-terminated string)
- **Data**: Protocol-specific data (varies by message type)

### Supported Commands

NexusIRC implements the following WeeChat relay commands:

| Command    | Description                                      |
| ---------- | ------------------------------------------------ |
| `init`     | Initialize connection, exchange capabilities     |
| `hdata`    | Request hierarchical data (buffers, lines, etc.) |
| `info`     | Get server information                           |
| `infolist` | Get information list                             |
| `nicklist` | Get/update nicklist for a buffer                 |
| `input`    | Send input to a buffer                           |
| `sync`     | Synchronize data                                 |
| `desync`   | Desynchronize data                               |
| `test`     | Test connection                                  |
| `ping`     | Ping server                                      |
| `quit`     | Disconnect                                       |

### Data Types

- `chr`: Character (1 byte)
- `int`: Integer (4 bytes, big-endian)
- `lon`: Long integer (8 bytes, big-endian)
- `str`: String (4-byte length + UTF-8 data)
- `buf`: Buffer (4-byte length + binary data)
- `ptr`: Pointer (8 bytes hex string)
- `tim`: Time (8 bytes, Unix timestamp)
- `htb`: Hashtable
- `hda`: HData (hierarchical data)
- `inf`: Info
- `inl`: Infolist
- `arr`: Array

---

## Advanced Configuration

### Multiple Relay Ports

Run multiple relay servers (e.g., one for internal, one for external):

```javascript
weechat: [
  {
    enable: true,
    host: "127.0.0.1",
    port: 9000,
    ssl: false,
    password: "internal-password",
  },
  {
    enable: true,
    host: "0.0.0.0",
    port: 9001,
    ssl: true,
    sslCert: "/path/to/cert.pem",
    sslKey: "/path/to/key.pem",
    password: "external-password",
  },
];
```

### Reverse Proxy

Use nginx to proxy WeeChat relay:

```nginx
server {
    listen 443 ssl;
    server_name irc.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /weechat {
        proxy_pass http://localhost:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

---

## Troubleshooting

### Connection Issues

| Symptom                | Cause                  | Solution                                   |
| ---------------------- | ---------------------- | ------------------------------------------ |
| `Connection refused`   | Relay not running      | Check config, restart NexusIRC             |
| `Invalid password`     | Wrong relay password   | Verify password in config                  |
| `Timeout`              | Firewall blocking port | Open port 9000 in firewall                 |
| `SSL handshake failed` | Invalid certificate    | Use valid cert or disable SSL verification |

### Debugging

#### Enable Debug Logging

```bash
# Start NexusIRC with debug output
DEBUG=nexusirc:weechat yarn dev
```

#### Check Relay Status

```bash
# From NexusIRC CLI
nexusirc relay status

# Expected output:
# WeeChat relay running on 0.0.0.0:9000
# Connected clients: 2
```

#### Monitor Connected Clients

```bash
# View connected clients
nexusirc relay clients

# Expected output:
# 192.168.1.100:54321 - Glowing Bear
# 192.168.1.101:54322 - weechat-android
```

### Common Errors

- **`Port already in use`**: Another service is using port 9000
  - Change port in configuration
  - Or stop conflicting service
- **`Certificate verify failed`**: Client doesn't trust certificate
  - Use valid certificate from CA
  - Or disable certificate verification in client
- **`Unsupported compression type`**: Client requested unsupported compression
  - Update NexusIRC or disable compression in client

---

## Security Considerations

### Recommendations

- ✅ Use SSL/TLS for relay connections
- ✅ Use strong relay passwords (min 16 characters)
- ✅ Bind to localhost if only local access needed
- ✅ Use a reverse proxy for external access
- ✅ Monitor connected clients regularly
- ✅ Rotate relay passwords periodically

### Network Security

```bash
# Restrict access with firewall (iptables)
sudo iptables -A INPUT -p tcp --dport 9000 -s 192.168.1.0/24 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9000 -j DROP
```

---

## Performance Tuning

### Compression

Enable compression for slow connections:

```javascript
weechat: {
    enable: true,
    port: 9000,
    compression: "zlib",  // or "zstd"
    compressionLevel: 6   // 1-9, higher = more compression
}
```

### Buffer Limits

Configure message buffer limits:

```javascript
weechat: {
    enable: true,
    port: 9000,
    maxBuffers: 1000,      // Max number of buffers
    maxLinesPerBuffer: 500 // Max lines per buffer
}
```

---

## References

- [WeeChat Relay Protocol Documentation](https://weechat.org/files/doc/devel/weechat_relay_protocol.en.html)
- [Glowing Bear](https://github.com/glowing-bear/glowing-bear)
- [weechat-android](https://github.com/ubergeek42/weechat-android)
- [NexusIRC Configuration Guide](Configuration.md)

---

[← Back to Configuration](Configuration.md)
