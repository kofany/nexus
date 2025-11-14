# Configuration Guide

This guide covers all configuration options available in NexusIRC.

## Table of Contents

- [Configuration File](#configuration-file)
- [Server Settings](#server-settings)
- [Client Settings](#client-settings)
- [Security Settings](#security-settings)
- [Storage Settings](#storage-settings)
- [Advanced Settings](#advanced-settings)
- [Environment Variables](#environment-variables)
- [Command-Line Options](#command-line-options)

---

## Configuration File

NexusIRC uses a JavaScript configuration file located at:
- **Linux/macOS**: `~/.nexusirc/config.js`
- **Windows**: `%APPDATA%\.nexusirc\config.js`

The configuration file is created automatically on first run with default values. You can edit it with any text editor.

### Example Configuration

```javascript
export default {
    public: false,
    host: "0.0.0.0",
    port: 19000,
    theme: "hunter",
    prefetch: true,
    messageStorage: ["sqlite"],
    // ... more options
}
```

After modifying the configuration, restart NexusIRC for changes to take effect:

```bash
nexusirc restart
```

---

## Server Settings

### `public`

**Type:** `boolean`  
**Default:** `false`

Determines the server mode:

- **`false` (Private Mode)**: Users must create accounts and log in. IRC connections persist when users disconnect.
- **`true` (Public Mode)**: No authentication required. IRC connections are lost when users leave.

```javascript
public: false
```

### `host`

**Type:** `string` or `undefined`  
**Default:** `undefined`

The IP address or hostname for the web server to listen on:

- `undefined` - Listen on all interfaces (0.0.0.0)
- `"127.0.0.1"` - Only accept local connections
- `"192.168.1.100"` - Specific IP address
- `"unix:/path/to/socket.sock"` - UNIX domain socket

```javascript
host: "127.0.0.1"  // Localhost only
```

### `port`

**Type:** `number`  
**Default:** `19000`

The TCP port number for the web server:

```javascript
port: 19000
```

### `bind`

**Type:** `string` or `undefined`  
**Default:** `undefined`

Local IP address to bind for outgoing IRC connections. Leave undefined to let the OS choose.

```javascript
bind: undefined
```

### `reverseProxy`

**Type:** `boolean`  
**Default:** `false`

Enable when running behind a reverse proxy (nginx, Apache, etc.). When enabled, NexusIRC honors the `X-Forwarded-For` header.

```javascript
reverseProxy: true
```

### `maxHistory`

**Type:** `number`  
**Default:** `10000`

Maximum number of messages to keep in memory per channel/query. Set to `-1` for unlimited.

```javascript
maxHistory: 10000
```

---

## Client Settings

### `theme`

**Type:** `string`  
**Default:** `"hunter"`

Default theme for new users. Available themes:
- `hunter` (default dark theme)
- `morning` (light theme)
- `solarized` (requires nexusirc-theme-solarized package)

```javascript
theme: "hunter"
```

### `prefetch`

**Type:** `boolean`  
**Default:** `false`

Enable automatic URL preview generation (thumbnails and descriptions).

```javascript
prefetch: true
```

### `disableMediaPreview`

**Type:** `boolean`  
**Default:** `false`

Disable previews for third-party media (images, video, audio) to prevent external requests.

```javascript
disableMediaPreview: false
```

### `prefetchStorage`

**Type:** `boolean`  
**Default:** `false`

Store and proxy prefetched images locally instead of hotlinking. Useful for HTTPS sites.

```javascript
prefetchStorage: true
```

### `prefetchMaxImageSize`

**Type:** `number`  
**Default:** `2048`

Maximum image size in kilobytes for preview generation.

```javascript
prefetchMaxImageSize: 2048
```

### `prefetchTimeout`

**Type:** `number`  
**Default:** `5000`

Timeout in milliseconds for fetching link previews.

```javascript
prefetchTimeout: 5000
```

### `fileUpload`

**Type:** `object`  
**Default:** `{ enable: false }`

File upload configuration:

```javascript
fileUpload: {
    enable: true,
    maxFileSize: 10240,  // 10 MB in KB
    baseUrl: "https://example.com/uploads/"
}
```

---

## Security Settings

### `https`

**Type:** `object`  
**Default:** `{ enable: false }`

HTTPS/TLS configuration:

```javascript
https: {
    enable: true,
    key: "/path/to/private-key.pem",
    certificate: "/path/to/certificate.pem",
    ca: "/path/to/ca-bundle.pem"  // Optional
}
```

**Note:** For production use, consider using a reverse proxy (nginx/Apache) instead.

### `ldap`

**Type:** `object`  
**Default:** `{ enable: false }`

LDAP authentication configuration:

```javascript
ldap: {
    enable: true,
    url: "ldaps://ldap.example.com",
    tlsOptions: {},
    primaryKey: "uid",
    baseDN: "ou=users,dc=example,dc=com",
    searchDN: {
        rootDN: "cn=admin,dc=example,dc=com",
        rootPassword: "password",
        filter: "(objectClass=person)"
    }
}
```

### `webirc`

**Type:** `object` or `null`  
**Default:** `null`

WebIRC gateway configuration for revealing user IPs to IRC servers:

```javascript
webirc: {
    "irc.libera.chat": "password123",
    "irc.oftc.net": "password456"
}
```

---

## Storage Settings

### `messageStorage`

**Type:** `array`  
**Default:** `["sqlite", "text"]`

Message storage backends to use (in order of preference):

```javascript
messageStorage: ["sqlite", "text"]
```

Options:
- `"sqlite"` - SQLite database (recommended, supports search)
- `"text"` - Plain text files (fallback)

### `storagePolicy`

**Type:** `object`  
**Default:** `{ enabled: false }`

Automatic message cleanup policy:

```javascript
storagePolicy: {
    enabled: true,
    maxAge: 90,  // Days to keep messages
    interval: 24 * 60 * 60 * 1000  // Cleanup interval (1 day)
}
```

---

## Advanced Settings

### `irssi`

**Type:** `object`  
**Default:** `{ enable: false }`

irssi FE-Web protocol integration:

```javascript
irssi: {
    enable: true,
    host: "127.0.0.1",
    port: 9001,
    ssl: true,
    encryptionKey: "your-encryption-key"
}
```

### `weechat`

**Type:** `object`  
**Default:** `{ enable: false }`

WeeChat relay server configuration:

```javascript
weechat: {
    enable: true,
    host: "0.0.0.0",
    port: 9000,
    ssl: false,
    password: "relay-password"
}
```

### `identd`

**Type:** `object`  
**Default:** `{ enable: false }`

Identd (RFC 1413) server configuration:

```javascript
identd: {
    enable: true,
    port: 113
}
```

### `oidentd`

**Type:** `string` or `null`  
**Default:** `null`

Path to oidentd configuration file:

```javascript
oidentd: "/home/user/.oidentd.conf"
```

### `debug`

**Type:** `object`  
**Default:** `{ raw: false }`

Debug options:

```javascript
debug: {
    raw: true,  // Log raw IRC messages
    irssi: true  // Log irssi protocol messages
}
```

### `defaults`

**Type:** `object`

Default values for new IRC connections:

```javascript
defaults: {
    name: "My Network",
    host: "irc.libera.chat",
    port: 6697,
    password: "",
    tls: true,
    rejectUnauthorized: true,
    nick: "user",
    username: "user",
    realname: "NexusIRC User",
    leaveMessage: "NexusIRC - https://github.com/outragelabs/nexusirc",
    join: "#nexusirc"
}
```

---

## Environment Variables

### `NEXUSIRC_HOME`

Override the configuration directory location:

```bash
export NEXUSIRC_HOME=/opt/nexusirc
nexusirc start
```

### `NODE_ENV`

Set the environment mode:

```bash
export NODE_ENV=production
```

Options:
- `production` - Optimized for production
- `development` - Development mode with extra debugging

### `DEBUG`

Enable debug logging:

```bash
export DEBUG=nexusirc:*
nexusirc start
```

---

## Command-Line Options

### `nexusirc start`

Start the NexusIRC server:

```bash
nexusirc start [options]
```

Options:
- `--config <path>` - Use a custom config file
- `--dev` - Start in development mode

### `nexusirc add <username>`

Add a new user (private mode only):

```bash
nexusirc add john
```

### `nexusirc remove <username>`

Remove a user:

```bash
nexusirc remove john
```

### `nexusirc reset <username>`

Reset a user's password:

```bash
nexusirc reset john
```

### `nexusirc edit <username>`

Edit a user's configuration:

```bash
nexusirc edit john
```

### `nexusirc list`

List all users:

```bash
nexusirc list
```

### `nexusirc upgrade`

Upgrade the configuration format:

```bash
nexusirc upgrade [from_version]
```

### `nexusirc storage`

Manage message storage:

```bash
# Clean up old messages
nexusirc storage clean

# Show storage statistics
nexusirc storage stats
```

---

## Configuration Examples

### Personal Server (Localhost Only)

```javascript
export default {
    public: false,
    host: "127.0.0.1",
    port: 19000,
    messageStorage: ["sqlite"],
    prefetch: true,
    prefetchStorage: true,
    fileUpload: {
        enable: true,
        maxFileSize: 5120
    }
}
```

### Public Server with Reverse Proxy

```javascript
export default {
    public: true,
    host: "127.0.0.1",
    port: 19000,
    reverseProxy: true,
    prefetch: true,
    disableMediaPreview: true,
    maxHistory: 1000,
    defaults: {
        name: "Libera",
        host: "irc.libera.chat",
        port: 6697,
        tls: true
    }
}
```

### Enterprise with LDAP

```javascript
export default {
    public: false,
    host: "0.0.0.0",
    port: 19000,
    reverseProxy: true,
    ldap: {
        enable: true,
        url: "ldaps://ldap.company.com",
        baseDN: "ou=users,dc=company,dc=com",
        searchDN: {
            rootDN: "cn=admin,dc=company,dc=com",
            rootPassword: process.env.LDAP_PASSWORD,
            filter: "(&(objectClass=person)(memberOf=cn=irc,ou=groups,dc=company,dc=com))"
        }
    },
    messageStorage: ["sqlite"],
    storagePolicy: {
        enabled: true,
        maxAge: 365
    }
}
```

### irssi Integration

```javascript
export default {
    public: false,
    host: "127.0.0.1",
    port: 19000,
    irssi: {
        enable: true,
        host: "127.0.0.1",
        port: 9001,
        ssl: true
    },
    messageStorage: ["sqlite"]
}
```

---

## Next Steps

- [irssi Integration Guide](Irssi-Integration.md) - Set up irssi FE-Web protocol
- [WeeChat Relay Guide](WeeChat-Relay.md) - Configure WeeChat relay
- [Troubleshooting](Troubleshooting.md) - Common configuration issues

---

[← Back to README](../README.md)
