import log from "../../../dist/server/log.js";
import {expect} from "chai";
import TestUtil from "../../util.ts";
import sinon from "sinon";
import packagePlugin from "../../../dist/server/plugins/packages/index.js";

let packages: typeof packagePlugin;

describe("packages", function () {
	let logInfoStub: sinon.SinonStub<string[], void>;

	beforeEach(async function () {
		logInfoStub = sinon.stub(log, "info");

		// ESM doesn't have require.cache, so we need to dynamically import with a cache buster
		const moduleUrl = new URL(
			`../../../dist/server/plugins/packages/index.js?update=${Date.now()}`,
			import.meta.url
		);
		const module = await import(moduleUrl.href);
		packages = module.default;
	});

	afterEach(function () {
		logInfoStub.restore();
	});

	describe(".getStylesheets", function () {
		it("should contain no stylesheets before packages are loaded", function () {
			expect(packages.getStylesheets()).to.be.empty;
		});

		it("should return the list of registered stylesheets for loaded packages", function () {
			packages.loadPackages();

			expect(packages.getStylesheets()).to.deep.equal(["thelounge-package-foo/style.css"]);
		});
	});

	describe(".getPackage", function () {
		it("should contain no reference to packages before loading them", function () {
			expect(packages.getPackage("thelounge-package-foo")).to.be.undefined;
		});

		it("should return details of a registered package after it was loaded", function () {
			packages.loadPackages();

			expect(packages.getPackage("thelounge-package-foo")).to.have.key("onServerStart");
		});
	});

	describe(".loadPackages", function () {
		it("should display report about loading packages", function () {
			// Mock `log.info` to extract its effect into a string
			logInfoStub.restore();
			let stdout = "";
			logInfoStub = sinon
				.stub(log, "info")
				.callsFake(TestUtil.sanitizeLog((str) => (stdout += str)));
			packages.loadPackages();

			expect(stdout).to.deep.equal(
				"Package thelounge-package-foo vdummy loaded\nThere are packages using the experimental plugin API. Be aware that this API is not yet stable and may change in future Nexus Lounge releases.\n"
			);
		});
	});
});
