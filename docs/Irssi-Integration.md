# irssi Integration Guide

This guide explains how to connect NexusIRC to an irssi instance using the FE-Web protocol bridge.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [Key Management](#key-management)
- [Testing the Connection](#testing-the-connection)
- [Troubleshooting](#troubleshooting)

---

## Overview

NexusIRC supports a direct integration with irssi via the **FE-Web protocol**. This allows NexusIRC to act as a multi-user web frontend while irssi continues to handle IRC connectivity.

### Benefits

- ✅ Continue using existing irssi workflow
- ✅ Multi-device web access with synchronized state
- ✅ Encrypted communication between NexusIRC and irssi
- ✅ Dual-layer security (TLS + AES-256-GCM)
- ✅ Persistent IRC connections managed by irssi

### Components

- **irssi**: Terminal IRC client running `fe-web` module
- **NexusIRC**: Web frontend providing multi-session access
- **FeWebSocket**: Node.js WebSocket client implementing the FE-Web protocol
- **Encryption Layer**: AES-256-GCM encryption built into the protocol

---

## Prerequisites

- **irssi** version 1.2 or later
- **fe-web module** for irssi (requires compilation)
- **OpenSSL** for TLS encryption (optional but recommended)
- **Node.js** (installed with NexusIRC)

### Required irssi Scripts/Modules

- `fe-web` module (official irssi module for web frontend)

### System Requirements

- NexusIRC server must be able to connect to irssi (localhost or network)
- irssi should run persistently (systemd service, tmux session, etc.)

---

## Architecture

```
┌────────────────────────┐      WebSocket (TLS)      ┌────────────────────────┐
│      NexusIRC          │◀──────────────────────────▶│      irssi (fe-web)     │
│                        │                           │                        │
│  • Client Manager      │                           │  • IRC connections      │
│  • Encrypted Storage   │                           │  • Channel management   │
│  • FeWebSocket client  │                           │  • Scripts/plugins      │
└────────────────────────┘                           └────────────────────────┘
         │                                                       │
         │ Socket.IO                                             │ IRC TCP
         ▼                                                       ▼
┌────────────────────────┐                           ┌────────────────────────┐
│  Web Browsers          │                           │  IRC Networks          │
│  (Vue 3 frontend)      │                           │  (libera, oftc, etc.) │
└────────────────────────┘                           └────────────────────────┘
```

### Security Layers

1. **TLS** (optional but recommended)
   - `wss://` connection from NexusIRC to irssi
   - Uses standard TLS certificates

2. **AES-256-GCM** (mandatory)
   - Protocol-level encryption
   - Uses PBKDF2-derived keys
   - Provides confidentiality and integrity

---

## Installation

### 1. Install irssi fe-web Module

#### Clone the fe-web Module Repository

```bash
# Replace with appropriate repository
mkdir -p ~/irssi-fe-web
cd ~/irssi-fe-web

# Example: git clone from official source
git clone https://github.com/irssi/irssi-fe-web.git .
```

#### Build the Module

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get install build-essential libglib2.0-dev libssl-dev

# Compile the module
make

# Install the module
sudo make install
```

**Expected Output:**
- `fe-web` module installed in irssi module directory (usually `/usr/lib/irssi/modules/`)

### 2. Configure irssi

Edit `~/.irssi/config`:

```cfg
# Example configuration
load = {
    "+fe_web" = "";
};

fe_web = {
    listen = {
        host = "127.0.0.1";
        port = "9001";
        use_ssl = "yes";
        cert = "/home/user/.irssi/certs/server.pem";
        key = "/home/user/.irssi/certs/server.key";
    };
    password = "irssi_password";
};
```

Create TLS certificates (optional but recommended):

```bash
mkdir -p ~/.irssi/certs
openssl req -new -x509 -days 365 -nodes \
    -out ~/.irssi/certs/server.pem \
    -keyout ~/.irssi/certs/server.key
```

Restart irssi to apply changes.

### 3. Verify irssi fe-web Module

```bash
# In irssi console
/script load fe_web
/feweb status
```

Expected output:
```
Fe-Web module is running on 127.0.0.1:9001 (SSL enabled)
```

---

## Configuration

### 1. NexusIRC Configuration (`~/.nexusirc/config.js`)

```javascript
export default {
    // ... other settings ...
    irssi: {
        enable: true,
        host: "127.0.0.1",
        port: 9001,
        ssl: true,
        rejectUnauthorized: false, // Set to true with valid certificates
        reconnect: {
            retries: 5,
            interval: 5000
        }
    },
    messageStorage: ["sqlite"],
    storagePolicy: {
        enabled: true,
        maxAge: 30
    }
}
```

### 2. User Configuration

Each user needs to configure their irssi connection.

#### Step 1: Add User (if not already)

```bash
nexusirc add alice
```

#### Step 2: Edit User Configuration

```bash
nexusirc edit alice
```

Add the irssi connection details:

```json
{
    "name": "alice",
    "password": "$2a$11$...",  // bcrypt hash
    "log": true,
    "irssiConnection": {
        "host": "127.0.0.1",
        "port": 9001,
        "passwordEncrypted": "..."  // Set via CLI
    }
}
```

### 3. Set irssi Password via CLI

```bash
nexusirc irssi set-password alice
```

You'll be prompted for:
- irssi host (default 127.0.0.1)
- irssi port (default 9001)
- SSL usage
- irssi password

NexusIRC will:
1. Encrypt the irssi password using AES-256-GCM
2. Store it in `users/alice.json`
3. Derive encryption keys on login

---

## Key Management

### Encryption Flow

```text
User Password: secret123
irssi Password: irssi_pass_456

1. Authentication Key
   - bcrypt(secret123)
   - Stored in users/alice.json

2. WebSocket Encryption Key
   - PBKDF2(
       password: irssi_pass_456,
       salt: "irssi-fe-web-v1",
       iterations: 10000,
       keyLen: 32,
       digest: "sha256"
     )
   - Used to encrypt/decrypt irssi messages

3. Message Storage Key
   - PBKDF2(
       password: secret123,
       salt: irssi_pass_456,
       iterations: 10000,
       keyLen: 32,
       digest: "sha256"
     )
   - Used for encrypting messages in SQLite
```

### Changing Passwords

#### Change irssi Password

1. Update `fe_web` configuration in irssi
2. Restart irssi
3. Update NexusIRC user configuration:

```bash
nexusirc irssi set-password alice
```

#### Change NexusIRC Password

```bash
nexusirc reset alice
```

After changing passwords, all sessions must reconnect.

---

## Testing the Connection

### 1. Start NexusIRC

```bash
nexusirc start
```

### 2. Monitor Logs

```bash
# Tail server logs
tail -f ~/.nexusirc/logs/server.log
```

### 3. Login via Web Interface

- Navigate to `http://localhost:19000`
- Log in with user credentials

### 4. Verify Connection

- Check that networks/channels from irssi appear
- Send messages and confirm they show up in irssi
- Join/part channels
- Verify message history and search

### 5. Validate Encryption

- Use Wireshark to inspect traffic (should be encrypted)
- Check that `~/.nexusirc/logs/` contains encrypted data

---

## Troubleshooting

### Connection Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| `Connection refused` | irssi fe-web not running | Check irssi output, ensure module is loaded |
| `Handshake failed` | TLS certificate issue | Set `rejectUnauthorized: false` temporarily or use valid certs |
| `Invalid password` | Wrong irssi password | Update using `nexusirc irssi set-password` |
| `Timeout` | Network/connectivity issues | Check firewall, network routing |
| `Encrypted message invalid` | Mismatched encryption key | Reset irssi password and reconfigure |

### Debugging

#### Enable irssi Debug Logging

```bash
# In irssi
/set fe_web_debug ON
```

#### Enable NexusIRC Debug Logging

```bash
DEBUG=nexusirc:irssi,nexusirc:feweb yarn dev
```

#### Check Logs

```bash
# NexusIRC logs
~/.nexusirc/logs/
    server.log
    irssi.log

# irssi logs
~/.irssi/logs/
```

### Common Errors

- **`Cannot find module fe_web`**: Reinstall module, verify installation path
- **`Error loading shared library`**: Missing dependencies, reinstall irssi with development headers
- **`Certificate verify failed`**: Use `rejectUnauthorized: false` during testing, then install proper certificates
- **`Message decryption failed`**: The encryption key is incorrect or message was tampered; reconfigure irssi password

---

## Best Practices

- Run irssi in a dedicated tmux session or systemd service
- Use TLS for irssi <-> NexusIRC communication
- Use strong passwords for both NexusIRC and irssi
- Restart NexusIRC periodically to clear encryption keys from memory
- Test configuration changes on staging environment first
- Monitor logs for any failed login attempts or errors

---

## References

- [irssi Official Website](https://irssi.org/)
- [irssi fe-web Module Documentation](https://github.com/irssi/irssi-fe-web)
- [NexusIRC Configuration Guide](Configuration.md)
- [Troubleshooting Guide](Troubleshooting.md)

---

[← Back to Configuration](Configuration.md)
