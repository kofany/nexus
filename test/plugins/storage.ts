import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import crypto from "crypto";
import {expect} from "chai";
import util from "../util.ts";
import Config from "../../dist/server/config.js";
import storage from "../../dist/server/plugins/storage.js";
import {Request, Response} from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Image storage", function () {
	// Increase timeout due to unpredictable I/O on CI services
	this.timeout(util.isRunningOnCI() ? 25000 : 5000);
	this.slow(300);

	const testImagePath = path.resolve(__dirname, "../../client/img/logo-grey-bg-120x120px.png");
	const correctImageHash = crypto
		.createHash("sha256")
		.update(fs.readFileSync(testImagePath))
		.digest("hex");
	const correctImageURL = `storage/${correctImageHash.substring(
		0,
		2
	)}/${correctImageHash.substring(2, 4)}/${correctImageHash.substring(4)}.png`;

	const testSvgPath = path.resolve(__dirname, "../../client/img/logo-grey-bg.svg");
	const correctSvgHash = crypto
		.createHash("sha256")
		.update(fs.readFileSync(testSvgPath))
		.digest("hex");
	const correctSvgURL = `storage/${correctSvgHash.substring(0, 2)}/${correctSvgHash.substring(
		2,
		4
	)}/${correctSvgHash.substring(4)}.svg`;

	before(function (done) {
		this.app = util.createWebserver();
		this.app.get("/real-test-image.png", function (req, res) {
			res.sendFile(testImagePath);
		});
		this.app.get("/logo.svg", function (req, res) {
			res.sendFile(testSvgPath);
		});
		this.connection = this.app.listen(0, "127.0.0.1", () => {
			this.port = this.connection.address().port;
			this.host = this.connection.address().address;
			done();
		});
		this._makeUrl = (_path: string): string => `http://${this.host}:${this.port}/${_path}`;
	});

	after(function (done) {
		this.connection.close(done);
	});

	after(function (done) {
		// After storage tests run, remove the remaining empty
		// storage folder so we return to the clean state
		const dir = Config.getStoragePath();
		fs.rmdir(dir, done);
	});

	beforeEach(function () {
		this.irc = util.createClient();
		this.network = util.createNetwork();

		Config.values.prefetchStorage = true;
	});

	afterEach(function () {
		Config.values.prefetchStorage = false;
	});

	it("should clear storage folder", function () {
		const dir = Config.getStoragePath();

		expect(fs.readdirSync(dir)).to.not.be.empty;
		storage.emptyDir();
		expect(fs.readdirSync(dir)).to.be.empty;
		expect(fs.existsSync(dir)).to.be.true;
	});
});
