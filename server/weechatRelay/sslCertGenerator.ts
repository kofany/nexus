/**
 * SSL/TLS Certificate Generator for WeeChat Relay
 * Generates self-signed certificates per user with SAN (Subject Alternative Name)
 * for compatibility with Android P+ and modern TLS clients
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {execSync} from "child_process";
import log from "../log.js";
import chalk from "chalk";

export interface CertificateInfo {
	certPath: string;
	keyPath: string;
}

/**
 * Get all local IP addresses for SAN
 */
function getLocalIPs(): string[] {
	const interfaces = os.networkInterfaces();
	const ips: string[] = [];

	for (const name of Object.keys(interfaces)) {
		const iface = interfaces[name];
		if (!iface) continue;

		for (const addr of iface) {
			// Skip internal (loopback) and non-IPv4 addresses
			if (addr.family === "IPv4" && !addr.internal) {
				ips.push(addr.address);
			}
		}
	}

	// Always include localhost
	if (!ips.includes("127.0.0.1")) {
		ips.push("127.0.0.1");
	}

	return ips;
}

/**
 * Generate CA-signed certificate for a user (for Qt/Lith compatibility)
 * Creates:
 * 1. CA certificate (self-signed root)
 * 2. Server certificate (signed by CA)
 * This is required because Qt doesn't trust pure self-signed certs even with allowSelfSignedCertificates=true
 * Includes SAN (Subject Alternative Name) for Android P+ compatibility
 */
export async function generateSelfSignedCert(
	username: string,
	certsDir: string
): Promise<CertificateInfo> {
	log.info(
		`${chalk.cyan("[SSL]")} Generating CA-signed certificate for user ${chalk.bold(
			username
		)}...`
	);

	// Create certs directory if it doesn't exist
	if (!fs.existsSync(certsDir)) {
		fs.mkdirSync(certsDir, {recursive: true});
	}

	const caCertPath = path.join(certsDir, `${username}-ca-cert.pem`);
	const caKeyPath = path.join(certsDir, `${username}-ca-key.pem`);
	const serverCertPath = path.join(certsDir, `${username}-cert.pem`);
	const serverKeyPath = path.join(certsDir, `${username}-key.pem`);
	const serverCsrPath = path.join(certsDir, `${username}-csr.pem`);
	const caConfigPath = path.join(certsDir, `${username}-ca-openssl.cnf`);
	const serverConfigPath = path.join(certsDir, `${username}-server-openssl.cnf`);

	// Check if cert already exists
	if (fs.existsSync(serverCertPath) && fs.existsSync(serverKeyPath)) {
		log.info(
			`${chalk.yellow("[SSL]")} Certificate already exists for ${chalk.bold(
				username
			)}, reusing`
		);
		return {certPath: serverCertPath, keyPath: serverKeyPath};
	}

	try {
		// Get local IPs for SAN
		const localIPs = getLocalIPs();
		const hostname = os.hostname();

		log.info(`${chalk.cyan("[SSL]")} Local IPs: ${localIPs.join(", ")}`);
		log.info(`${chalk.cyan("[SSL]")} Hostname: ${hostname}`);

		// Create SAN entries
		const sanEntries = [
			`DNS:nexuslounge-${username}.local`,
			`DNS:${hostname}`,
			`DNS:localhost`,
			...localIPs.map((ip) => `IP:${ip}`),
		];

		// STEP 1: Generate CA certificate (root, self-signed)
		log.info(`${chalk.cyan("[SSL]")} Step 1: Generating CA certificate...`);

		const caConfig = `
[req]
default_bits = 4096
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ca

[dn]
CN = NexusIRC CA - ${username}
O = NexusIRC
OU = Certificate Authority

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`;

		fs.writeFileSync(caConfigPath, caConfig);

		const caCmd = `openssl req -x509 -newkey rsa:4096 -keyout "${caKeyPath}" -out "${caCertPath}" -days 3650 -nodes -config "${caConfigPath}" -extensions v3_ca`;
		execSync(caCmd, {stdio: "pipe"});

		log.info(`${chalk.green("[SSL]")} ✅ CA certificate generated`);

		// STEP 2: Generate server private key and CSR
		log.info(`${chalk.cyan("[SSL]")} Step 2: Generating server key and CSR...`);

		const serverConfig = `
[req]
default_bits = 4096
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
CN = nexuslounge-${username}.local
O = NexusIRC
OU = WeeChat Relay

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
${sanEntries
	.map(
		(entry, i) =>
			`${entry.startsWith("DNS:") ? `DNS.${i + 1}` : `IP.${i + 1}`} = ${entry.split(":")[1]}`
	)
	.join("\n")}
`;

		fs.writeFileSync(serverConfigPath, serverConfig);

		const serverKeyCmd = `openssl req -newkey rsa:4096 -keyout "${serverKeyPath}" -out "${serverCsrPath}" -nodes -config "${serverConfigPath}"`;
		execSync(serverKeyCmd, {stdio: "pipe"});

		log.info(`${chalk.green("[SSL]")} ✅ Server key and CSR generated`);

		// STEP 3: Sign server certificate with CA
		log.info(`${chalk.cyan("[SSL]")} Step 3: Signing server certificate with CA...`);

		const signCmd = `openssl x509 -req -in "${serverCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${serverCertPath}" -days 365 -sha256 -extfile "${serverConfigPath}" -extensions v3_req`;
		execSync(signCmd, {stdio: "pipe"});

		log.info(`${chalk.green("[SSL]")} ✅ Server certificate signed by CA`);

		// STEP 4: Create full chain certificate (server cert + CA cert)
		// This is REQUIRED for Qt/Lith - they need the full chain in one file!
		log.info(`${chalk.cyan("[SSL]")} Step 4: Creating full chain certificate...`);

		const serverCertContent = fs.readFileSync(serverCertPath, "utf8");
		const caCertContent = fs.readFileSync(caCertPath, "utf8");
		const fullChainPath = path.join(certsDir, `${username}-fullchain.pem`);

		// Concatenate: server cert FIRST, then CA cert
		fs.writeFileSync(fullChainPath, serverCertContent + "\n" + caCertContent);

		log.info(`${chalk.green("[SSL]")} ✅ Full chain certificate created`);

		// Clean up temporary files
		fs.unlinkSync(caConfigPath);
		fs.unlinkSync(serverConfigPath);
		fs.unlinkSync(serverCsrPath);

		if (fs.existsSync(path.join(certsDir, `${username}-ca-cert.srl`))) {
			fs.unlinkSync(path.join(certsDir, `${username}-ca-cert.srl`));
		}

		log.info(
			`${chalk.green("[SSL]")} ✅ Generated CA-signed certificate for ${chalk.bold(
				username
			)}`
		);
		log.info(`${chalk.green("[SSL]")}    CA Cert: ${caCertPath}`);
		log.info(`${chalk.green("[SSL]")}    CA Key:  ${caKeyPath}`);
		log.info(`${chalk.green("[SSL]")}    Server Cert: ${serverCertPath}`);
		log.info(`${chalk.green("[SSL]")}    Full Chain: ${fullChainPath}`);
		log.info(`${chalk.green("[SSL]")}    Server Key:  ${serverKeyPath}`);
		log.info(`${chalk.green("[SSL]")}    SAN entries: ${sanEntries.length}`);

		// Return FULL CHAIN cert (not just server cert!)
		return {certPath: fullChainPath, keyPath: serverKeyPath};
	} catch (error: any) {
		log.error(
			`${chalk.red("[SSL]")} ❌ Failed to generate certificate for ${chalk.bold(
				username
			)}: ${error.message}`
		);
		throw new Error(`Failed to generate SSL certificate: ${error.message}`);
	}
}

/**
 * Validate that certificate files exist and are readable
 */
export function validateCertificate(certPath: string, keyPath: string): boolean {
	if (!fs.existsSync(certPath)) {
		log.error(`${chalk.red("[SSL]")} Certificate file not found: ${certPath}`);
		return false;
	}

	if (!fs.existsSync(keyPath)) {
		log.error(`${chalk.red("[SSL]")} Private key file not found: ${keyPath}`);
		return false;
	}

	try {
		fs.accessSync(certPath, fs.constants.R_OK);
		fs.accessSync(keyPath, fs.constants.R_OK);
		return true;
	} catch (error) {
		log.error(`${chalk.red("[SSL]")} Certificate files are not readable`);
		return false;
	}
}

/**
 * Delete certificate files for a user
 */
export function deleteCertificate(certPath: string, keyPath: string): void {
	try {
		if (fs.existsSync(certPath)) {
			fs.unlinkSync(certPath);
			log.info(`${chalk.green("[SSL]")} Deleted certificate: ${certPath}`);
		}

		if (fs.existsSync(keyPath)) {
			fs.unlinkSync(keyPath);
			log.info(`${chalk.green("[SSL]")} Deleted private key: ${keyPath}`);
		}
	} catch (error: any) {
		log.error(`${chalk.red("[SSL]")} Failed to delete certificate: ${error.message}`);
	}
}
