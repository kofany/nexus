import fs from "fs";
import path from "path";
import {expect} from "chai";
import ClientCertificate, {type ClientCertificateType} from "../../dist/server/plugins/clientCertificate.js";
import Config from "../../dist/server/config.js";

describe("ClientCertificate", function () {
	it("should generate a client certificate", async function () {
		const certificate = await ClientCertificate.get("this-is-test-uuid") as ClientCertificateType;

		expect(certificate.certificate).to.match(/^-----BEGIN CERTIFICATE-----/);
		expect(certificate.private_key).to.match(/^-----BEGIN PRIVATE KEY-----/);

		const certificate2 = await ClientCertificate.get("this-is-test-uuid") as ClientCertificateType;
		expect(certificate2.certificate).to.equal(certificate.certificate);
		expect(certificate2.private_key).to.equal(certificate.private_key);
	});

	it("should remove the client certificate files", function () {
		const privateKeyPath = path.join(
			Config.getClientCertificatesPath(),
			`this-is-test-uuid.pem`
		);
		const certificatePath = path.join(
			Config.getClientCertificatesPath(),
			`this-is-test-uuid.crt`
		);

		expect(fs.existsSync(privateKeyPath)).to.be.true;
		expect(fs.existsSync(certificatePath)).to.be.true;

		ClientCertificate.remove("this-is-test-uuid");

		expect(fs.existsSync(privateKeyPath)).to.be.false;
		expect(fs.existsSync(certificatePath)).to.be.false;
	});
});
