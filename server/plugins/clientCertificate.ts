import path from "path";
import fs from "fs";
import crypto from "crypto";
import {Crypto} from "@peculiar/webcrypto";
import * as x509 from "@peculiar/x509";
import log from "../log.js";
import Config from "../config.js";

// Setup Web Crypto API
const webcrypto = new Crypto();
x509.cryptoProvider.set(webcrypto);

export default {
	get,
	remove,
};

export type ClientCertificateType = {
	private_key: string;
	certificate: string;
};

async function get(uuid: string): Promise<ClientCertificateType | null> {
	const folderPath = Config.getClientCertificatesPath();
	const paths = getPaths(folderPath, uuid);

	if (!fs.existsSync(paths.privateKeyPath) || !fs.existsSync(paths.certificatePath)) {
		return await generateAndWrite(folderPath, paths);
	}

	try {
		return {
			private_key: fs.readFileSync(paths.privateKeyPath, "utf-8"),
			certificate: fs.readFileSync(paths.certificatePath, "utf-8"),
		};
	} catch (e: any) {
		log.error("Unable to get certificate", e);
	}

	return null;
}

function remove(uuid: string) {
	const paths = getPaths(Config.getClientCertificatesPath(), uuid);

	try {
		if (fs.existsSync(paths.privateKeyPath)) {
			fs.unlinkSync(paths.privateKeyPath);
		}

		if (fs.existsSync(paths.certificatePath)) {
			fs.unlinkSync(paths.certificatePath);
		}
	} catch (e: any) {
		log.error("Unable to remove certificate", e);
	}
}

async function generateAndWrite(
	folderPath: string,
	paths: {privateKeyPath: any; certificatePath: any}
): Promise<ClientCertificateType | null> {
	const certificate = await generate();

	try {
		fs.mkdirSync(folderPath, {recursive: true});

		fs.writeFileSync(paths.privateKeyPath, certificate.private_key, {
			mode: 0o600,
		});
		fs.writeFileSync(paths.certificatePath, certificate.certificate, {
			mode: 0o600,
		});

		return certificate;
	} catch (e: any) {
		log.error("Unable to write certificate", String(e));
	}

	return null;
}

async function generate(): Promise<ClientCertificateType> {
	// Generate RSA key pair
	const keys = await webcrypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"]
	);

	// Create certificate
	const cert = await x509.X509CertificateGenerator.createSelfSigned(
		{
			name: "CN=The Lounge IRC Client",
			keys,
			notBefore: (() => {
				const date = new Date();
				date.setDate(date.getDate() - 1);
				return date;
			})(),
			notAfter: (() => {
				const date = new Date();
				date.setFullYear(date.getFullYear() + 100);
				return date;
			})(),
			serialNumber: crypto.randomBytes(16).toString("hex").toUpperCase(),
			signingAlgorithm: {
				name: "RSASSA-PKCS1-v1_5",
				hash: "SHA-256",
			},
			extensions: [
				new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], false),
				new x509.KeyUsagesExtension(
					x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
					false
				),
			],
		},
		webcrypto
	);

	// Export to PEM format
	const privateKeyPem = await webcrypto.subtle.exportKey("pkcs8", keys.privateKey);
	const privateKeyPemString = toPem(privateKeyPem, "PRIVATE KEY");

	const pem: ClientCertificateType = {
		private_key: privateKeyPemString,
		certificate: cert.toString("pem"),
	};

	return pem;
}

function toPem(buffer: ArrayBuffer, type: string): string {
	const base64 = Buffer.from(buffer).toString("base64");
	const lines: string[] = [];

	for (let i = 0; i < base64.length; i += 64) {
		lines.push(base64.substring(i, i + 64));
	}

	return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
}

function getPaths(folderPath: string, uuid: string) {
	return {
		privateKeyPath: path.join(folderPath, `${uuid}.pem`),
		certificatePath: path.join(folderPath, `${uuid}.crt`),
	};
}
