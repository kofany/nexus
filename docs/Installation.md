# Installation Guide

This guide provides detailed installation instructions for NexusIRC on various platforms.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Methods](#installation-methods)
  - [Using NPM (Recommended for Production)](#using-npm-recommended-for-production)
  - [From Source](#from-source)
  - [Using Docker](#using-docker)
- [Platform-Specific Instructions](#platform-specific-instructions)
- [Post-Installation](#post-installation)
- [Upgrading](#upgrading)
- [Uninstallation](#uninstallation)

---

## Prerequisites

### Required

- **Node.js** version 22.0.0 or higher
  - Download from [nodejs.org](https://nodejs.org/)
  - Verify installation: `node --version`

- **Corepack** (included with Node.js ≥ 16.9)
  - Enable it: `corepack enable`
  - This will manage the correct Yarn version automatically

- **irssi or erssi** with FE-Web module
  - NexusIRC requires a running irssi/erssi instance
  - See [irssi Integration Guide](Irssi-Integration.md) for setup

### Optional

- **SQLite3** - For persistent message storage (recommended)
- **Build tools** - Required when installing from source or building native modules
  - **Linux**: `build-essential`, `python3`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools

### Important Note

**NexusIRC does NOT connect directly to IRC networks.** All IRC connectivity is handled by irssi/erssi. You must have a working irssi/erssi instance with the FE-Web module before NexusIRC can be used.

---

## Installation Methods

### Using NPM (Recommended for Production)

This is the simplest method for end users:

```bash
# Enable Corepack
corepack enable

# Install NexusIRC globally
npm install --global nexusirc

# Verify installation
nexusirc --version

# Start the server
nexusirc start
```

The application will be available at `http://localhost:9000`

### From Source

Recommended for development or if you want the latest features:

```bash
# Clone the repository
git clone https://github.com/outragelabs/nexusirc.git
cd nexusirc

# Enable Corepack
corepack enable

# Install dependencies
yarn install

# Build the application
NODE_ENV=production yarn build

# Start the server
yarn start
```

Alternatively, you can run directly without installing:

```bash
node index.mjs start
```

### Using Docker

Docker support coming soon. For now, you can create your own Dockerfile based on the source installation method.

---

## Platform-Specific Instructions

### Linux

#### Ubuntu/Debian

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build tools
sudo apt-get install -y build-essential python3

# Enable Corepack
corepack enable

# Install NexusIRC
npm install --global nexusirc
```

#### Fedora/RHEL/CentOS

```bash
# Install Node.js
sudo dnf module install nodejs:22

# Install build tools
sudo dnf install gcc-c++ make python3

# Enable Corepack
corepack enable

# Install NexusIRC
npm install --global nexusirc
```

#### Arch Linux

```bash
# Install Node.js
sudo pacman -S nodejs npm

# Enable Corepack
corepack enable

# Install NexusIRC
npm install --global nexusirc
```

### macOS

```bash
# Using Homebrew
brew install node@22

# Enable Corepack
corepack enable

# Install Xcode Command Line Tools (if not already installed)
xcode-select --install

# Install NexusIRC
npm install --global nexusirc
```

### Windows

1. Download and install Node.js from [nodejs.org](https://nodejs.org/)
2. Open PowerShell or Command Prompt as Administrator
3. Enable Corepack:
   ```powershell
   corepack enable
   ```
4. Install NexusIRC:
   ```powershell
   npm install --global nexusirc
   ```

---

## Post-Installation

### Configuration Directory

NexusIRC stores its configuration in:

- **Linux/macOS**: `~/.nexusirc`
- **Windows**: `%APPDATA%\.nexusirc`

You can override this location with the `NEXUSIRC_HOME` environment variable:

```bash
export NEXUSIRC_HOME=/path/to/config
```

### First Run

On first run, NexusIRC will:

1. Create the configuration directory
2. Generate a default `config.js` file
3. Create necessary subdirectories (`users/`, `logs/`, etc.)

Access the web interface at `http://localhost:9000` (or the configured host/port).

### Creating the First User

When running in private mode (default), you need to create a user account:

```bash
nexusirc add <username>
```

You'll be prompted to enter a password. This user can then log in through the web interface.

### Systemd Service (Linux)

Create a systemd service file at `/etc/systemd/system/nexusirc.service`:

```ini
[Unit]
Description=NexusIRC
After=network.target

[Service]
Type=simple
User=nexusirc
ExecStart=/usr/bin/nexusirc start
Restart=on-failure
Environment="NEXUSIRC_HOME=/var/lib/nexusirc"

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable nexusirc
sudo systemctl start nexusirc
```

### launchd Service (macOS)

Create a plist file at `~/Library/LaunchAgents/com.nexusirc.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nexusirc</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/nexusirc</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.nexusirc.plist
```

---

## Upgrading

### From NPM Installation

```bash
npm update --global nexusirc
```

### From Source Installation

```bash
cd nexusirc
git pull
yarn install
NODE_ENV=production yarn build
```

After upgrading, restart the server:

```bash
nexusirc restart
```

### Database Migrations

NexusIRC will automatically run database migrations on startup if needed. Always backup your data before upgrading:

```bash
cp -r ~/.nexusirc ~/.nexusirc.backup
```

---

## Uninstallation

### NPM Installation

```bash
# Stop the server
nexusirc stop

# Uninstall the package
npm uninstall --global nexusirc

# Optionally, remove configuration and data
rm -rf ~/.nexusirc
```

### Source Installation

```bash
# Stop the server
# Remove the cloned directory
rm -rf /path/to/nexusirc

# Optionally, remove configuration and data
rm -rf ~/.nexusirc
```

---

## Troubleshooting Installation Issues

### Permission Errors

If you encounter permission errors during global npm installation:

```bash
# Option 1: Use a Node version manager (recommended)
# Install nvm: https://github.com/nvm-sh/nvm
nvm install 22
nvm use 22
npm install --global nexusirc

# Option 2: Change npm's default directory
# See: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally
```

### Build Failures

If native modules fail to build:

1. Ensure you have build tools installed (see [Prerequisites](#prerequisites))
2. Clear npm cache: `npm cache clean --force`
3. Remove node_modules and reinstall: `rm -rf node_modules && yarn install`

### SQLite3 Installation Issues

If SQLite3 fails to install:

```bash
# Install SQLite3 development files
# Ubuntu/Debian:
sudo apt-get install libsqlite3-dev

# Fedora/RHEL:
sudo dnf install sqlite-devel

# macOS:
brew install sqlite3
```

Then rebuild:

```bash
npm rebuild sqlite3
```

### Corepack Not Found

If Corepack is not available:

```bash
# Node.js < 16.9: Install Corepack manually
npm install -g corepack
corepack enable
```

---

## Next Steps

- [Configuration Guide](Configuration.md) - Configure NexusIRC for your needs
- [irssi Integration](Irssi-Integration.md) - Connect to irssi FE-Web protocol
- [WeeChat Relay](WeeChat-Relay.md) - Set up the WeeChat relay
- [Troubleshooting](Troubleshooting.md) - Common issues and solutions

---

[← Back to README](../README.md)
