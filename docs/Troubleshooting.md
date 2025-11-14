# Troubleshooting Guide

This guide covers common issues and solutions for NexusIRC.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Startup Issues](#startup-issues)
- [Authentication Problems](#authentication-problems)
- [Network Connectivity](#network-connectivity)
- [irssi Integration Problems](#irssi-integration-problems)
- [WeeChat Relay Issues](#weechat-relay-issues)
- [Message Storage](#message-storage)
- [File Uploads](#file-uploads)
- [Performance](#performance)
- [Logging and Debugging](#logging-and-debugging)
- [Resetting NexusIRC](#resetting-nexusirc)

---

## Installation Issues

### npm Install Permission Errors

**Symptoms:**
- `EACCES: permission denied`
- `npm ERR! code EACCES`

**Causes:**
- Insufficient permissions for global npm install

**Solutions:**
1. Use Node Version Manager (recommended)
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   nvm install 22
   nvm use 22
   npm install --global nexusirc
   ```

2. Change npm global directory
   ```bash
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   export PATH=~/.npm-global/bin:$PATH
   npm install --global nexusirc
   ```

### Corepack Not Found

**Symptoms:** `corepack: command not found`

**Solutions:**
```bash
# Install Corepack manually
npm install -g corepack
corepack enable
```

### SQLite3 Compilation Error

**Symptoms:**
- `Error: sqlite3 binding failed`
- `node-gyp rebuild` errors

**Solutions:**
```bash
# Install build dependencies
# Ubuntu/Debian
sudo apt-get install build-essential python3 libsqlite3-dev

# macOS
xcode-select --install
brew install sqlite3

# Rebuild sqlite3
npm rebuild sqlite3
```

---

## Startup Issues

### Node Version Error

**Symptoms:**
- `NexusIRC requires Node.js >=22.0.0`

**Solution:** Upgrade Node.js to version 22.0.0 or later.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### `dist/server/index.js` Not Found

**Symptoms:**
- `Files in ./dist/server/ not found`

**Causes:**
- Server not built (`yarn build` not run)

**Solution:**
```bash
NODE_ENV=production yarn build
yarn start
```

### Port Already in Use

**Symptoms:**
- `EADDRINUSE: address already in use`

**Solution:**
```bash
# Find process using port 19000
lsof -i :19000

# Kill process
kill -9 <PID>
```

### Configuration Syntax Errors

**Symptoms:**
- `SyntaxError: Unexpected token`

**Cause:** Invalid syntax in `config.js`

**Solution:**
- Check `~/.nexusirc/config.js` for syntax errors
- Ensure trailing commas are used correctly
- Wrap strings in double quotes

---

## Authentication Problems

### Invalid Username or Password

**Symptoms:** `Authentication failed`

**Solutions:**
- Verify username/password
- Reset password:
  ```bash
  nexusirc reset <username>
  ```
- Check `~/.nexusirc/users/<username>.json`

### Session Expired

**Symptoms:** Continuous logout after login

**Solutions:**
- Clear browser cookies
- Ensure server clock is synchronized (use NTP)
- Check for proxy interfering with cookies

### LDAP Authentication Fails

**Symptoms:** `LDAP bind failed`

**Solutions:**
- Verify LDAP server URL and credentials
- Check firewall between NexusIRC and LDAP server
- Test connection with `ldapsearch`

---

## Network Connectivity

### Cannot Connect to IRC Network

**Symptoms:**
- `Connection refused`
- `Network timeout`

**Solutions:**
- Check IRC server host/port
- Verify TLS settings (`tls: true/false`)
- Allow outbound connections on firewall
- Use `ping` and `traceroute` to test connectivity

### Certificate Errors

**Symptoms:**
- `CERT_HAS_EXPIRED`
- `self signed certificate`

**Solutions:**
- Update `rejectUnauthorized: false` (temporary)
- Install proper CA certificates
- Update system root certificates

### Nickname in Use

**Symptoms:**
- `Nickname is already in use`

**Solutions:**
- Configure alternate nick:
  ```javascript
  defaults: {
      nick: "myusername",
      alt_nicks: ["myusername_", "myusername__"]
  }
  ```
- Set SASL username/password

---

## irssi Integration Problems

### `Connection refused`

**Cause:** irssi fe-web module not running

**Solutions:**
- Load module in irssi: `/script load fe_web`
- Check irssi logs for errors
- Ensure `fe_web` configured in `~/.irssi/config`

### `Invalid password`

**Cause:** irssi password mismatch

**Solution:** Update password:
```bash
nexusirc irssi set-password <username>
```

### `Encrypted message invalid`

**Cause:** Wrong encryption key or tampered message

**Solutions:**
- Reset irssi password
- Regenerate encryption keys
- Check for TLS issues

### TLS Handshake Failed

**Symptoms:** `SSL_HANDSHAKE_FAILURE`

**Solutions:**
- Set `rejectUnauthorized: false`
- Import irssi certificate into NexusIRC trust store
- Use proper CA-signed certificates

---

## WeeChat Relay Issues

### Relay Server Not Accessible

**Symptoms:** `Connection refused`

**Solutions:**
- Ensure `weechat.enable = true` in config
- Check relay port (default 9000)
- Open port in firewall
- Restart NexusIRC

### Invalid Relay Password

**Symptoms:** `Invalid password`

**Solution:** Verify password in config and client

### SSL/TLS Issues

**Symptoms:** `TLS handshake failed`

**Solutions:**
- Use valid certificate
- Configure client to trust certificate
- Disable SSL temporarily for testing

---

## Message Storage

### SQLite Errors

**Symptoms:**
- `SQLITE_ERROR: unable to open database file`
- `SQLITE_BUSY`

**Solutions:**
- Check file permissions on `~/.nexusirc/logs`
- Ensure enough disk space
- Run storage cleanup:
  ```bash
  nexusirc storage clean
  ```

### Storage Cleanup Fails

**Symptoms:** `Storage cleanup failed`

**Solutions:**
- Stop NexusIRC before running cleanup
- Increase storage cleanup timeout in config
- Check logs for detailed error

### Message Search Not Working

**Cause:** SQLite storage not enabled

**Solution:**
```javascript
messageStorage: ["sqlite"]
```

---

## File Uploads

### Upload Fails

**Symptoms:** `413 Payload Too Large`, `upload failed`

**Solutions:**
- Increase `fileUpload.maxFileSize`
- Check disk space
- Ensure `fileUpload.enable = true`

### File Not Accessible

**Symptoms:** `404 Not Found`

**Solutions:**
- Check `fileUpload.baseUrl`
- Ensure storage directory exists
- Verify reverse proxy configuration

---

## Performance

### High CPU Usage

**Causes:**
- Too many active connections
- Large message backlog
- Heavy search usage

**Solutions:**
- Enable storage cleanup policy
- Limit `maxHistory`
- Optimize reverse proxy caching
- Scale horizontally (multiple instances)

### Memory Usage Growth

**Causes:**
- Excessive in-memory history
- Large file uploads stored in memory

**Solutions:**
- Reduce `maxHistory`
- Enable storage cleanup
- Monitor `storagePolicy`

---

## Logging and Debugging

### Enable Debug Logging

```bash
DEBUG=nexusirc:* yarn dev
```

### Log Files

```
~/.nexusirc/logs/
├── server.log        # Server logs
├── irssi.log         # irssi integration logs
├── relay.log         # WeeChat relay logs
└── storage.log       # Storage operations
```

### Tail Logs

```bash
tail -f ~/.nexusirc/logs/server.log
```

### Generate Support Bundle

```bash
nexusirc debug bundle
```

---

## Resetting NexusIRC

### Reset Configuration

```bash
mv ~/.nexusirc ~/.nexusirc.backup
nexusirc start
```

### Remove User Data

```bash
nexusirc remove <username>
rm ~/.nexusirc/users/<username>.json
rm ~/.nexusirc/logs/<username>/*
```

### Clean Storage

```bash
rm -rf ~/.nexusirc/storage
rm -rf ~/.nexusirc/uploads
```

---

## Support

If issues persist:

1. Check [GitHub Issues](https://github.com/outragelabs/nexusirc/issues)
2. Search [Discussions](https://github.com/outragelabs/nexusirc/discussions)
3. Provide detailed logs, configuration, and steps to reproduce
4. Include environment info (OS, Node.js version, NexusIRC version)

---

[← Back to README](../README.md)
