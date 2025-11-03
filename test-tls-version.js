const tls = require("tls");

console.log("Testing TLS connection to irssi...\n");

const options = {
	host: "localhost",
	port: 9001,
	rejectUnauthorized: false,
	minVersion: "TLSv1.2",
	maxVersion: "TLSv1.3",
};

console.log("Options:", JSON.stringify(options, null, 2));

const socket = tls.connect(options, () => {
	console.log("\n✅ TLS connection established!");
	console.log("Protocol:", socket.getProtocol());
	console.log("Cipher:", socket.getCipher());
	console.log("Authorized:", socket.authorized);

	// Send HTTP GET (WebSocket handshake)
	const request =
		"GET /?password=Pulinek1708 HTTP/1.1\r\n" +
		"Host: localhost:9001\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"\r\n";

	console.log("\nSending WebSocket handshake...");
	socket.write(request);
});

socket.on("data", (data) => {
	console.log("\n📨 Received data:", data.length, "bytes");
	console.log("Data (hex):", data.toString("hex").substring(0, 100));
	console.log("Data (text):", data.toString("utf8").substring(0, 200));

	// Check protocol after receiving data
	console.log("\nProtocol after data:", socket.getProtocol());
});

socket.on("error", (error) => {
	console.log("\n❌ TLS error:", error.message);
	console.log("Error code:", error.code);
});

socket.on("close", () => {
	console.log("\n🔒 TLS connection closed");
	process.exit(0);
});

setTimeout(() => {
	console.log("\n⏱️  Timeout");
	socket.end();
}, 5000);
