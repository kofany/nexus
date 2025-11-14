# NexusIRC

<div align="center">

**Web Frontend for irssi/erssi with WeeChat Relay Support**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![Yarn Version](https://img.shields.io/badge/yarn-4.10.3-blue)](https://yarnpkg.com/)

[Features](#-features) • [Installation](#-installation) • [Documentation](#-documentation) • [Contributing](#-contributing) • [Support](#-support)

</div>

---

## 📖 Overview

NexusIRC is a heavily customized fork of [The Lounge](https://github.com/thelounge/thelounge), completely redesigned as a **multi-user web frontend for irssi/erssi**. All IRC connectivity is handled exclusively through the **irssi FE-Web protocol** - NexusIRC has no direct IRC client functionality. It also includes a built-in **WeeChat relay** server for additional client compatibility.

### Key Highlights

- 🔌 **irssi/erssi Frontend**: Web interface that connects exclusively to irssi/erssi via FE-Web protocol
- 🌐 **Multi-User**: Multiple users can access their own irssi instances through a single web interface
- 🔐 **Secure**: AES-256-GCM encryption for irssi protocol communication and message storage
- 🔄 **WeeChat Relay**: Built-in relay server for WeeChat protocol clients
- 💻 **Modern Stack**: Built with TypeScript, Vue 3, and Socket.IO for real-time communication
- 🎨 **Multi-Session**: Access your irssi session from multiple browsers/devices simultaneously

---

## ✨ Features

### Core Functionality
- **irssi FE-Web Protocol Client**: Connects to irssi/erssi instances via encrypted WebSocket
- **Multi-User Support**: Each user connects to their own irssi instance
- **Multi-Session Sync**: Use multiple browsers/devices with synchronized state
- **Rich Message History**: SQLite-based message storage with search capabilities
- **Encrypted Storage**: AES-256-GCM encryption for messages at rest
- **File Uploads**: Built-in file hosting for sharing images and files
- **Push Notifications**: Desktop and mobile notifications for mentions and messages

### Protocol Bridges
- **irssi FE-Web Protocol**: Full integration with irssi's web frontend protocol (mandatory)
- **WeeChat Relay**: Built-in relay server for WeeChat protocol clients
- **Dual-Layer Security**: TLS + AES-256-GCM encryption for irssi communication

### User Experience
- **Persistent Connections**: irssi stays connected even when browser is closed
- **Link Previews**: Automatic preview generation for URLs, images, and videos
- **LDAP Authentication**: Enterprise-ready authentication support
- **Responsive Design**: Works on desktop, tablet, and mobile devices

### Developer-Friendly
- **TypeScript**: Fully typed codebase for better maintainability
- **Vue 3**: Modern reactive frontend framework
- **Plugin System**: Extensible architecture for custom functionality
- **API Access**: Socket.IO events and REST endpoints
- **Hot Reload**: Development mode with automatic reloading

---

## 🚀 Installation

### Prerequisites

- **Node.js** ≥ 22.0.0 ([Download](https://nodejs.org/))
- **Yarn** 4.10.3 (managed via Corepack)
- **irssi or erssi** with FE-Web module installed and configured
- **Optional**: SQLite3 for message storage

### Important: irssi/erssi Requirement

**NexusIRC requires a running irssi or erssi instance with the FE-Web module.** It does NOT connect directly to IRC networks. All IRC connectivity is managed by irssi/erssi.

### Quick Start

#### From Package Registry

```bash
# Enable Corepack (if not already enabled)
corepack enable

# Install globally
npm install --global nexusirc

# Start the server
nexusirc start
```

The application will be available at `http://localhost:19000`

#### From Source

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

### Configuration

NexusIRC stores its configuration in `~/.nexusirc` by default. You can change this location by setting the `NEXUSIRC_HOME` environment variable:

```bash
export NEXUSIRC_HOME=/path/to/config
nexusirc start
```

On first run, a default configuration file will be created. Edit `~/.nexusirc/config.js` to configure your irssi connection:

```javascript
export default {
    irssi: {
        enable: true,
        host: "127.0.0.1",
        port: 9001,
        ssl: true
    },
    messageStorage: ["sqlite"]
}
```

**Next Steps:** See the [irssi Integration Guide](docs/Irssi-Integration.md) for detailed setup instructions.

---

## 📚 Documentation

Comprehensive documentation is available in the [docs/](docs/) directory:

- **[Installation Guide](docs/Installation.md)** - Detailed installation instructions
- **[Configuration Guide](docs/Configuration.md)** - Complete configuration reference
- **[irssi Integration](docs/Irssi-Integration.md)** - **REQUIRED** - Setting up irssi FE-Web protocol
- **[Architecture Documentation](docs/Architecture.md)** - System architecture and design decisions
- **[WeeChat Relay](docs/WeeChat-Relay.md)** - Configuring the WeeChat relay server
- **[Development Guide](docs/Development.md)** - Contributing and development workflow
- **[API Reference](docs/API.md)** - Socket.IO events and REST API documentation
- **[Troubleshooting](docs/Troubleshooting.md)** - Common issues and solutions

---

## 🛠️ Development

### Development Mode

```bash
# Start with hot module reloading
yarn dev
```

The development server will start with automatic reloading when you make changes.

### Building

```bash
# Build client-side code
yarn build:client

# Build server-side code
yarn build:server

# Build everything
yarn build
```

### Testing

```bash
# Run all tests
yarn test

# Run only unit tests
yarn test:mocha

# Run linters
yarn lint
```

### Code Quality

```bash
# Format code with Prettier
yarn format:prettier

# Install git hooks
yarn githooks-install
```

---

## 🏗️ Architecture

NexusIRC is built as a multi-user web frontend for irssi/erssi:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Browsers                              │
│       Desktop • Mobile • Tablet • Multiple Sessions          │
└────────────────────────────┬────────────────────────────────────┘
                             │ Socket.IO (WebSocket)
┌────────────────────────────▼────────────────────────────────────┐
│                    NexusIRC Server                               │
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
│  │  │  (Required)  │  │  (Optional)  │                     │   │
│  │  └──────────────┘  └──────────────┘                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Storage Layer                               │   │
│  │  • SQLite (encrypted messages)                          │   │
│  │  • Text logs (fallback)                                 │   │
│  │  • File uploads                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │ FE-Web Protocol (WebSocket)
                             │ AES-256-GCM Encrypted
┌────────────────────────────▼────────────────────────────────────┐
│                  irssi/erssi Instance                            │
│  • Handles ALL IRC connectivity                                 │
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

**Important:** NexusIRC does NOT connect directly to IRC. All IRC functionality is provided by irssi/erssi.

For detailed architecture documentation, see [docs/Architecture.md](docs/Architecture.md).

---

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Run `yarn test` before submitting changes
- Follow the existing code style (enforced by ESLint and Prettier)
- Write meaningful commit messages
- Update documentation for new features
- Add tests for new functionality

For more details, see [docs/Development.md](docs/Development.md).

---

## 📄 License

NexusIRC is distributed under the [MIT License](LICENSE).

This project is a fork of [The Lounge](https://github.com/thelounge/thelounge), which is also licensed under MIT.

---

## 🙏 Acknowledgments

- **The Lounge Team** - For creating the excellent foundation this project is built upon
- **irssi Project** - For the IRC client and FE-Web protocol specification
- **erssi Project** - For the enhanced irssi fork
- **WeeChat Project** - For the relay protocol
- All contributors who have helped improve this project

---

## 💬 Support

- **Documentation**: Check the [docs/](docs/) directory for detailed guides
- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/outragelabs/nexusirc/issues)
- **Discussions**: Join conversations on [GitHub Discussions](https://github.com/outragelabs/nexusirc/discussions)

---

## 🔗 Links

- **GitHub Repository**: https://github.com/outragelabs/nexusirc
- **The Lounge**: https://github.com/thelounge/thelounge
- **irssi**: https://irssi.org/
- **erssi**: https://github.com/erssi-org/erssi
- **WeeChat**: https://weechat.org/

---

<div align="center">

Made with ❤️ by the NexusIRC community

**[⬆ back to top](#nexusirc)**

</div>
