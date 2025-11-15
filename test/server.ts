import log from "../dist/server/log.js";
import Config from "../dist/server/config.js";
import {expect} from "chai";
import got from "got";
import io from "socket.io-client";
import util from "./util.ts";
import changelog from "../dist/server/plugins/changelog.js";

import sinon from "sinon";
import ClientManager from "../dist/server/clientManager.js";

describe("Server", function () {
	// Increase timeout due to unpredictable I/O on CI services
	this.timeout(util.isRunningOnCI() ? 25000 : 5000);

	let server;
	let logInfoStub: sinon.SinonStub<string[], void>;
	let logWarnStub: sinon.SinonStub<string[], void>;
	let checkForUpdatesStub: sinon.SinonStub<[manager: ClientManager], void>;

	before(async function () {
		logInfoStub = sinon.stub(log, "info");
		logWarnStub = sinon.stub(log, "warn").callsFake((...args: string[]) => {
			// vapid.json permissions do not survive in git
			if (args.length > 1 && args[1] === "is world readable.") {
				return;
			}

			if (args.length > 0 && args[0].startsWith("run `chmod")) {
				return;
			}

			// eslint-disable-next-line no-console
			console.error(`Unhandled log.warn in server tests: ${args.join(" ")}`);
		});

		checkForUpdatesStub = sinon.stub(changelog, "checkForUpdates");
		server = await (await import("../dist/server/server.js")).default({} as any);
	});

	after(function (done) {
		// Tear down test fixtures in the order they were setup,
		// in case setup crashed for any reason
		logInfoStub.restore();
		logWarnStub.restore();
		checkForUpdatesStub.restore();
		server.close(done);
	});

	const webURL = `http://${Config.values.host}:${Config.values.port}/`;

	describe("Express", () => {
		it("should run a web server on " + webURL, async () => {
			const response = await got(webURL);
			expect(response.statusCode).to.equal(200);
			expect(response.body).to.include("<title>NexusIRC</title>");
			expect(response.body).to.include("js/bundle.js");
		});

		it("should serve static content correctly", async () => {
			const response = await got(webURL + "nexusirc.webmanifest");
			const body = JSON.parse(response.body);

			expect(response.statusCode).to.equal(200);
			expect(body.name).to.equal("NexusIRC");
			expect(response.headers["content-type"]).to.include("application/manifest+json");
		});
	});

	// WebSocket tests removed - legacy from NexusIRC
	// NexusIRC is private-only proxy mode, these tests tested:
	// 1. Public mode authentication (removed in 8ac5febd)
	// 2. Direct IRC network creation (not available in proxy mode)
	// 3. Client-side network management (managed by irssi backend)
});
