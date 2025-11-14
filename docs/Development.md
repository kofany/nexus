# Development Guide

This guide covers everything you need to know to contribute to NexusIRC development.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Debugging](#debugging)
- [Building and Deploying](#building-and-deploying)
- [Contributing](#contributing)

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 22.0.0
- **Yarn** 4.10.3 (managed via Corepack)
- **Git**
- **Text Editor** (VS Code recommended)

### Initial Setup

```bash
# Fork the repository on GitHub
# Clone your fork
git clone https://github.com/YOUR_USERNAME/nexusirc.git
cd nexusirc

# Add upstream remote
git remote add upstream https://github.com/outragelabs/nexusirc.git

# Enable Corepack
corepack enable

# Install dependencies
yarn install

# Install git hooks
yarn githooks-install
```

### Development Environment

#### VS Code Configuration

Recommended extensions (`.vscode/extensions.json`):
- `dbaeumer.vscode-eslint` - ESLint
- `esbenp.prettier-vscode` - Prettier
- `Vue.volar` - Vue language support
- `stylelint.vscode-stylelint` - Stylelint

#### Environment Variables

Create a `.env` file (not committed):
```bash
NODE_ENV=development
DEBUG=nexusirc:*
NEXUSIRC_HOME=./dev-data
```

---

## Development Workflow

### Running in Development Mode

```bash
# Start with hot reloading
yarn dev
```

This starts:
- Express server on port 19000
- WebSocket server
- Webpack dev middleware with HMR
- TypeScript compiler in watch mode

Access at `http://localhost:19000`

### Watch Modes

```bash
# Watch client-side changes only
yarn watch

# Watch server-side changes (requires manual restart)
yarn build:server --watch
```

### Creating a Feature Branch

```bash
# Update your local main
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/amazing-feature

# Make changes...
git add .
git commit -m "Add amazing feature"

# Push to your fork
git push origin feature/amazing-feature
```

### Keeping Your Fork Updated

```bash
# Fetch upstream changes
git fetch upstream

# Rebase your branch
git checkout feature/amazing-feature
git rebase upstream/main

# Force push (if already pushed)
git push origin feature/amazing-feature --force-with-lease
```

---

## Project Structure

```
nexusirc/
├── client/                 # Frontend code
│   ├── js/                # Vue 3 application
│   │   ├── components/    # Vue components
│   │   ├── store.ts       # Vuex state management
│   │   ├── router.ts      # Vue Router
│   │   ├── socket.ts      # Socket.IO client
│   │   └── main.ts        # Entry point
│   ├── css/              # Stylesheets
│   ├── fonts/            # Web fonts
│   └── index.html.tpl    # HTML template
├── server/                # Backend code
│   ├── clientManager.ts  # User management
│   ├── irssiClient.ts    # IRC client logic
│   ├── server.ts         # Express + Socket.IO
│   ├── models/           # Data models
│   ├── plugins/          # Plugin system
│   ├── feWebClient/      # irssi FE-Web protocol
│   ├── weechatRelay/     # WeeChat relay
│   └── command-line/     # CLI commands
├── shared/               # Shared types and utilities
├── test/                 # Test suites
├── defaults/             # Default configuration
├── public/               # Built static files (generated)
├── dist/                 # Built server files (generated)
├── docs/                 # Documentation
├── scripts/              # Build and utility scripts
├── package.json
├── tsconfig.json
├── webpack.config.ts
└── README.md
```

### Key Files

| File | Purpose |
|------|---------|
| `server/server.ts` | Main server setup, Express, Socket.IO |
| `server/clientManager.ts` | User/client lifecycle management |
| `server/irssiClient.ts` | IRC connection handling |
| `client/js/main.ts` | Frontend entry point |
| `client/js/socket.ts` | Socket.IO client setup |
| `webpack.config.ts` | Build configuration |
| `tsconfig.json` | TypeScript configuration |

---

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Avoid `any` type; use proper types
- Export types for reusability
- Use strict mode

**Example:**
```typescript
// Good
interface NetworkConfig {
    name: string;
    host: string;
    port: number;
    tls: boolean;
}

function connectNetwork(config: NetworkConfig): Promise<void> {
    // ...
}

// Bad
function connectNetwork(config: any): any {
    // ...
}
```

### Vue Components

- Use Composition API for new components
- Type props and emits
- Use `<script setup lang="ts">`

**Example:**
```vue
<script setup lang="ts">
import { ref, computed } from "vue";

interface Props {
    message: string;
    highlight?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    highlight: false,
});

const emit = defineEmits<{
    (e: "click", id: number): void;
}>();
</script>
```

### Code Style

We use ESLint and Prettier for code formatting:

```bash
# Check code style
yarn lint

# Auto-fix issues
yarn format:prettier

# Check specific files
yarn lint:eslint server/server.ts
```

**Key Rules:**
- Indentation: Tabs
- Semicolons: Required
- Quotes: Double quotes
- Line length: 100 characters
- Trailing commas: ES5

### Git Commit Messages

Follow conventional commits:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting)
- `refactor`: Code refactoring
- `test`: Tests
- `chore`: Build, dependencies, etc.

**Examples:**
```
feat(client): add message search functionality

Implement full-text search using SQLite FTS5.
Includes pagination and highlight support.

Closes #123

---

fix(server): prevent memory leak in message storage

The LRU cache was not properly evicting old entries.

---

docs: update installation guide for Node.js 22
```

---

## Testing

### Running Tests

```bash
# Run all tests
yarn test

# Run only unit tests
yarn test:mocha

# Run specific test file
yarn test:mocha test/server/models/msg.ts

# Run with coverage
yarn coverage
```

### Writing Tests

We use Mocha + Chai for testing:

**Example Test:**
```typescript
// test/server/models/msg.test.ts
import { expect } from "chai";
import Msg from "../../../server/models/msg";

describe("Msg", function() {
    describe("#constructor", function() {
        it("should create a message with text", function() {
            const msg = new Msg({
                text: "Hello world",
                from: { nick: "test" }
            });
            
            expect(msg.text).to.equal("Hello world");
            expect(msg.from.nick).to.equal("test");
        });
    });
    
    describe("#isHighlight", function() {
        it("should detect nick mentions", function() {
            const msg = new Msg({
                text: "test: hello",
                from: { nick: "alice" }
            });
            
            expect(msg.isHighlight("test")).to.be.true;
            expect(msg.isHighlight("bob")).to.be.false;
        });
    });
});
```

### Test Structure

```
test/
├── client/              # Frontend tests
│   ├── js/
│   └── components/
├── server/              # Backend tests
│   ├── models/
│   ├── plugins/
│   └── feWebClient/
├── fixtures/            # Test data
└── .mocharc.yml        # Mocha configuration
```

### Running Frontend Tests

```bash
# Run Vue component tests
yarn test:mocha test/client/**/*.test.ts
```

---

## Debugging

### Server-Side Debugging

#### VS Code Launch Configuration

Create `.vscode/launch.json`:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "node",
            "request": "launch",
            "name": "Debug Server",
            "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/ts-node",
            "args": [
                "--project", "server/tsconfig.json",
                "server/index.ts",
                "start",
                "--dev"
            ],
            "env": {
                "NODE_ENV": "development"
            },
            "console": "integratedTerminal"
        }
    ]
}
```

#### Console Logging

```typescript
import log from "../log";

log.info("Server started on port", port);
log.warn("Connection failed, retrying...");
log.error("Fatal error:", error);
log.debug("Debug info:", data);
```

#### Enable Debug Output

```bash
# All debug output
DEBUG=nexusirc:* yarn dev

# Specific modules
DEBUG=nexusirc:server,nexusirc:irssi yarn dev
```

### Client-Side Debugging

#### Browser DevTools

- **Vue DevTools**: Install browser extension for Vue inspection
- **Network Tab**: Monitor Socket.IO messages
- **Console**: Check for errors and logs

#### Debugging in Browser

```javascript
// Client console
nexusirc.store.state.networks  // View network state
nexusirc.socket.emit("input", {...})  // Send test events
```

### Common Issues

**Port Already in Use:**
```bash
# Find process using port
lsof -i :19000

# Kill process
kill -9 <PID>
```

**Build Failures:**
```bash
# Clear caches
rm -rf node_modules dist public/js public/css
yarn install
yarn build
```

**TypeScript Errors:**
```bash
# Check types without building
yarn tsc --noEmit
```

---

## Building and Deploying

### Production Build

```bash
# Full production build
NODE_ENV=production yarn build

# This creates:
# - dist/server/ - Compiled server code
# - public/js/ - Bundled client JavaScript
# - public/css/ - Minified CSS
```

### Build Artifacts

```
dist/
└── server/         # Compiled TypeScript
    ├── index.js
    ├── server.js
    └── ...

public/
├── js/
│   └── bundle.js   # Bundled client code
├── css/
│   └── style.css   # Minified styles
└── fonts/          # Web fonts
```

### Testing Production Build

```bash
NODE_ENV=production yarn start
```

### Deployment Checklist

- [ ] All tests pass: `yarn test`
- [ ] No linting errors: `yarn lint`
- [ ] Production build successful: `NODE_ENV=production yarn build`
- [ ] Configuration updated for production
- [ ] Environment variables set
- [ ] Reverse proxy configured (nginx/Apache)
- [ ] HTTPS certificates in place
- [ ] Backups configured
- [ ] Monitoring in place

---

## Contributing

### Pull Request Process

1. **Create an issue** describing the feature/bug
2. **Fork** the repository
3. **Create a branch** from `main`
4. **Make changes** following coding standards
5. **Write tests** for new functionality
6. **Run tests** and linters: `yarn test`
7. **Commit** with descriptive messages
8. **Push** to your fork
9. **Open a PR** with:
   - Clear description of changes
   - Link to related issue
   - Screenshots (if UI changes)
   - Test coverage information

### Code Review Process

All PRs require:
- ✅ Passing CI checks
- ✅ At least one approving review
- ✅ No merge conflicts
- ✅ Updated documentation (if needed)

### Documentation

When adding features, update:
- Inline code comments (for complex logic)
- JSDoc/TSDoc (for public APIs)
- README.md (if user-facing)
- Relevant docs/ files
- CHANGELOG.md (keep it updated)

### Release Process

Releases are managed by maintainers:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create git tag: `git tag v4.x.x`
4. Push tag: `git push --tags`
5. GitHub Actions builds and publishes to npm

---

## Development Resources

### Useful Commands

```bash
# Install dependencies
yarn install

# Start development server
yarn dev

# Build for production
yarn build

# Run tests
yarn test

# Format code
yarn format:prettier

# Lint code
yarn lint

# Install git hooks
yarn githooks-install

# Add a user (private mode)
node index.mjs add <username>

# Generate config documentation
yarn generate:config:doc
```

### TypeScript Tips

```typescript
// Import types
import type { Socket } from "socket.io";
import type { NetworkConfig } from "./models/network";

// Define interfaces
interface UserConfig {
    name: string;
    password: string;
}

// Use enums
enum MessageType {
    Message = "message",
    Action = "action",
    Notice = "notice"
}

// Type guards
function isNetworkConfig(obj: unknown): obj is NetworkConfig {
    return typeof obj === "object" && 
           obj !== null && 
           "host" in obj;
}
```

### Vue 3 Tips

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";

// Reactive state
const count = ref(0);

// Computed property
const doubled = computed(() => count.value * 2);

// Watch changes
watch(count, (newVal, oldVal) => {
    console.log(`Count changed from ${oldVal} to ${newVal}`);
});

// Lifecycle hooks
onMounted(() => {
    console.log("Component mounted");
});
</script>
```

---

## Getting Help

- **Documentation**: Check [docs/](.) directory
- **GitHub Issues**: [Report bugs or request features](https://github.com/outragelabs/nexusirc/issues)
- **GitHub Discussions**: [Ask questions](https://github.com/outragelabs/nexusirc/discussions)
- **Code of Conduct**: Be respectful and inclusive

---

[← Back to README](../README.md)
