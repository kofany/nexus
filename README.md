# NexusIRC

<div align="center">

**Modern Web IRC Client with Advanced Protocol Support**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![Yarn Version](https://img.shields.io/badge/yarn-4.10.3-blue)](https://yarnpkg.com/)

[Features](#-features) • [Installation](#-installation) • [Documentation](#-documentation) • [Contributing](#-contributing) • [Support](#-support)

</div>

---

## 📖 Overview

NexusIRC is a heavily customized fork of [The Lounge](https://github.com/thelounge/thelounge), engineered to provide seamless integration with **irssi FE-Web protocol** workflows and featuring a built-in **WeeChat relay** for bridge connections. It combines the convenience of a modern web interface with the power of persistent IRC connections and advanced protocol support.

### Key Highlights

- 🔌 **Always Connected**: Server maintains persistent IRC connections while clients come and go
- 🌐 **Cross-Platform**: Runs anywhere Node.js is supported with a responsive web interface
- 🔐 **Secure**: Built-in encryption, SSL/TLS support, and client certificate authentication
- 🔄 **Protocol Bridges**: Native irssi FE-Web and WeeChat relay protocol support
- 💻 **Modern Stack**: Built with TypeScript, Vue 3, and Socket.IO for real-time communication
- 🎨 **Customizable**: Themeable interface with extensive configuration options

---

## ✨ Features

### Core IRC Functionality
- **Multi-Network Support**: Connect to multiple IRC networks simultaneously
- **Persistent Connections**: Stay connected even when your browser is closed
- **Rich Message History**: SQLite-based message storage with search capabilities
- **File Uploads**: Built-in file hosting for sharing images and files
- **Push Notifications**: Desktop and mobile notifications for mentions and messages

### Advanced Features
- **irssi FE-Web Protocol**: Full integration with irssi's web frontend protocol
- **WeeChat Relay**: Built-in relay server for WeeChat protocol clients
- **Multi-Session Sync**: Use multiple browsers/devices with synchronized state
- **Encrypted Storage**: AES-256-GCM encryption for message storage
- **Link Previews**: Automatic preview generation for URLs, images, and videos
- **LDAP Authentication**: Enterprise-ready authentication support

### Developer-Friendly
- **TypeScript**: Fully typed codebase for better maintainability
- **Vue 3**: Modern reactive frontend framework
- **Plugin System**: Extensible architecture for custom functionality
- **API Access**: RESTful API for integration with other tools
- **Hot Reload**: Development mode with automatic reloading

---

## 🚀 Installation

### Prerequisites

- **Node.js** ≥ 22.0.0 ([Download](https://nodejs.org/))
- **Yarn** 4.10.3 (managed via Corepack)
- **Optional**: SQLite3 for message storage

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

The application will be available at `http://localhost:9000`

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

On first run, a default configuration file will be created. Edit `~/.nexusirc/config.js` to customize your installation.

---

## 📚 Documentation

Comprehensive documentation is available in the [docs/](docs/) directory:

- **[Installation Guide](docs/Installation.md)** - Detailed installation instructions for various platforms
- **[Configuration Guide](docs/Configuration.md)** - Complete configuration reference
- **[Architecture Documentation](docs/Architecture.md)** - System architecture and design decisions
- **[Development Guide](docs/Development.md)** - Contributing and development workflow
- **[irssi Integration](docs/Irssi-Integration.md)** - Setting up irssi FE-Web protocol
- **[WeeChat Relay](docs/WeeChat-Relay.md)** - Configuring the WeeChat relay server
- **[API Reference](docs/API.md)** - REST API documentation
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

NexusIRC is built on a layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Browsers                              │
│       Desktop • Mobile • Tablet • Multiple Sessions          │
└────────────────────────────┬────────────────────────────────┘
                             │ Socket.IO (WebSocket)
┌────────────────────────────▼────────────────────────────────┐
│                    NexusIRC Server                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Client Manager (Multi-User Support)                   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Protocol Adapters                                     │ │
│  │  • irssi FE-Web Protocol (AES-256-GCM encrypted)       │ │
│  │  • WeeChat Relay Protocol                             │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Storage Layer (SQLite + Encrypted Messages)           │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
┌────────▼────────┐                    ┌─────────▼──────────┐
│  irssi fe-web   │                    │  IRC Networks      │
│  Protocol       │                    │  (Direct Connect)  │
└─────────────────┘                    └────────────────────┘
```

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
- **irssi Project** - For the FE-Web protocol specification
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
- **WeeChat**: https://weechat.org/

---

<div align="center">

Made with ❤️ by the NexusIRC community

**[⬆ back to top](#nexusirc)**

</div>
