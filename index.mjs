#!/usr/bin/env node

import {fileURLToPath} from "url";
import {dirname} from "path";
import {readFileSync, existsSync} from "fs";
import semver from "semver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

process.chdir(__dirname);

// Perform node version check before loading any other files or modules
// Doing this check as soon as possible allows us to
// avoid ES6 parser errors or other issues
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const writeError = (...parts) => {
	process.stderr.write(`${parts.join("")}${process.platform === "win32" ? "\r\n" : "\n"}`);
};

if (!semver.satisfies(process.version, pkg.engines.node)) {
	writeError(
		"NexusIRC requires Node.js ",
		pkg.engines.node,
		" (current version: ",
		process.version,
		")"
	);
	writeError("Please upgrade Node.js in order to use NexusIRC");
	writeError("");

	process.exit(1);
}

if (existsSync("./dist/server/index.js")) {
	await import("./dist/server/index.js");
} else {
	writeError(
		"Files in ./dist/server/ not found. Please run `yarn build` before trying to run `node index.mjs`."
	);

	process.exit(1);
}
