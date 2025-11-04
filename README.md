# Nexus Lounge

Nexus Lounge is our heavily customized fork of [The Lounge](https://github.com/thelounge/thelounge). It is tailored to integrate erssi/irssi FE-Web protocol workflows and ships with an additional WeeChat relay so that "incoming" clients can bridge through the same gateway.

## Overview

- **Built for erssi/irssi FE-Web protocol deployments.** Nexus Lounge extends the original architecture with protocol adapters and helper tooling required by erssi environments.
- **Always connected IRC access.** The server remains connected to IRC networks while clients come and go.
- **Cross platform and responsive.** Works wherever Node.js runs and adapts to desktop and mobile browsers.
- **WeeChat relay for incoming clients.** A bundled relay layer enables both Nexus Lounge and external WeeChat relay compatible consumers to connect simultaneously.

## Installation and usage

Nexus Lounge requires the latest [Node.js](https://nodejs.org/) LTS version or more recent. The [Yarn package manager](https://yarnpkg.com/) is also recommended.

### Install from a package registry

```sh
npm install --global nexuslounge
```

The CLI binary is named `nexuslounge`. After installing you can run:

```sh
nexuslounge start
```

Configuration data is stored in `~/.nexuslounge` by default. Set the `NEXUSLOUNGE_HOME` environment variable to override the location.

### Running from source

```sh
git clone https://github.com/erssi-org/nexuslounge.git
cd nexuslounge
yarn install
NODE_ENV=production yarn build
yarn start
```

When running from source, commands can also be executed directly via:

```sh
node index start
```

## Development guidelines

- Run `yarn test` before submitting changes.
- Use `yarn build:client` when updating anything in `client/js` or `client/components`.
- Use `yarn build:server` when updating server-side TypeScript in `server/`.
- `yarn dev` starts Nexus Lounge with hot module reloading for local development.

To install the pre-commit hook run `yarn githooks-install`.

## Licensing

Nexus Lounge continues to be distributed under the MIT license. See [LICENSE](LICENSE) for details.
