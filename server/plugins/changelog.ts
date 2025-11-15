import got, {HTTPError} from "got";
import chalk from "chalk";
import log from "../log.js";
import pkg from "../../package.json" with {type: "json"};
import ClientManager from "../clientManager.js";
import Config from "../config.js";
import {SharedChangelogData} from "../../shared/types/changelog.js";

const TIME_TO_LIVE = 15 * 60 * 1000; // 15 minutes, in milliseconds

// Use local variable for mutable state instead of module.exports (ESM compatibility)
let isUpdateAvailable = false;

export default {
	get isUpdateAvailable() {
		return isUpdateAvailable;
	},
	fetch,
	checkForUpdates,
};
const versions: SharedChangelogData = {
	current: {
		prerelease: false,
		version: `v${pkg.version}`,
		changelog: undefined,
		url: "", // TODO: properly init
	},
	expiresAt: -1,
	latest: undefined,
	packages: undefined,
};

type GithubRelease = {
	tag_name: string;
	body_html: string;
	prerelease: boolean;
	html_url: string;
};

async function fetch() {
	const time = Date.now();

	// Serving information from cache
	if (versions.expiresAt > time) {
		return versions;
	}

	try {
		const response = await got.get<GithubRelease[]>(
			"https://api.github.com/repos/thelounge/thelounge/releases",
			{
				headers: {
					Accept: "application/vnd.github.v3.html", // Request rendered markdown
					"User-Agent": pkg.name + "; +" + pkg.repository.url, // Identify the client
				},
				localAddress: Config.values.bind,
				responseType: "json",
			}
		);

		if (response.statusCode !== 200 || !Array.isArray(response.body)) {
			return versions;
		}

		updateVersions(response.body);

		// Add expiration date to the data to send to the client for later refresh
		versions.expiresAt = time + TIME_TO_LIVE;
	} catch (error) {
		if (error instanceof HTTPError) {
			log.error(`Failed to fetch changelog: ${error.response.statusCode} ${error.message}`);
		} else {
			log.error(
				`Failed to fetch changelog: ${error instanceof Error ? error.message : error}`
			);
		}
	}

	return versions;
}

function updateVersions(releases: GithubRelease[]) {
	let i: number;
	let release: GithubRelease;
	let prerelease = false;

	// Find the current release among releases on GitHub
	for (i = 0; i < releases.length; i++) {
		release = releases[i];

		if (release.tag_name === versions.current.version) {
			versions.current.changelog = release.body_html;
			prerelease = release.prerelease;

			break;
		}
	}

	// Find the latest release made after the current one if there is one
	if (i > 0) {
		for (let j = 0; j < i; j++) {
			release = releases[j];

			// Find latest release or pre-release if current version is also a pre-release
			if (!release.prerelease || release.prerelease === prerelease) {
				isUpdateAvailable = true;

				versions.latest = {
					prerelease: release.prerelease,
					version: release.tag_name,
					url: release.html_url,
				};

				break;
			}
		}
	}
}

function checkForUpdates(manager: ClientManager) {
	fetch()
		.then((versionData) => {
			if (!isUpdateAvailable) {
				// Check for updates every 24 hours + random jitter of <3 hours
				setTimeout(
					() => checkForUpdates(manager),
					24 * 3600 * 1000 + Math.floor(Math.random() * 10000000)
				);
			}

			if (!versionData.latest) {
				return;
			}

			log.info(
				`NexusIRC ${chalk.green(
					versionData.latest.version
				)} is available. Read more on GitHub: ${versionData.latest.url}`
			);

			// Notify all connected clients about the new version
			manager.clients.forEach((client) => client.emit("changelog:newversion"));
		})
		.catch((error: Error) => {
			log.error(`Failed to check for updates: ${error.message}`);
		});
}
