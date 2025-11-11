const WebSocket = require("ws");
const tls = require("tls");

// Monkey-patch tls.connect to see what options are passed
const originalTlsConnect = tls.connect;

tls.connect = function (...args) {
	console.log("\n=== tls.connect called ===");
	console.log("Arguments:", JSON.stringify(args, null, 2));
	return originalTlsConnect.apply(this, args);
};

console.log("Testing WebSocket with TLS options...\n");

const wsOptions = {
	rejectUnauthorized: false,
	minVersion: "TLSv1.2",
	maxVersion: "TLSv1.3",
};

console.log("Creating WebSocket with:");
console.log("  URL: wss://localhost:9001/?password=Pulinek1708");
console.log("  Options:", JSON.stringify(wsOptions, null, 2));

const ws = new WebSocket("wss://localhost:9001/?password=Pulinek1708", undefined, wsOptions);

ws.on("open", () => {
	console.log("\n✅ WebSocket opened!");
	ws.close();
});

ws.on("error", (error) => {
	console.log("\n❌ WebSocket error:", error.message);
	console.log("Error code:", error.code);
});

ws.on("close", () => {
	console.log("\n🔒 WebSocket closed");
	process.exit(0);
});

setTimeout(() => {
	console.log("\n⏱️  Timeout - closing");
	process.exit(1);
}, 5000);
