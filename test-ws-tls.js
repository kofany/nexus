const WebSocket = require("ws");

console.log("Testing WebSocket TLS connection to irssi...");

// Test 1: Without TLS options (should fail)
console.log("\n=== Test 1: Without TLS options ===");

try {
	const ws1 = new WebSocket("wss://localhost:9001/?password=Pulinek1708");

	ws1.on("open", () => {
		console.log("✅ Test 1: Connected WITHOUT TLS options!");
		ws1.close();
	});

	ws1.on("error", (error) => {
		console.log("❌ Test 1: Error WITHOUT TLS options:", error.message);
	});
} catch (error) {
	console.log("❌ Test 1: Exception:", error.message);
}

// Wait 2 seconds
setTimeout(() => {
	// Test 2: With TLS options as 2nd parameter (WRONG!)
	console.log("\n=== Test 2: TLS options as 2nd parameter (WRONG) ===");

	try {
		const wsOptions = {
			rejectUnauthorized: false,
			minVersion: "TLSv1.2",
			maxVersion: "TLSv1.3",
		};

		const ws2 = new WebSocket("wss://localhost:9001/?password=Pulinek1708", wsOptions);

		ws2.on("open", () => {
			console.log("✅ Test 2: Connected with TLS options as 2nd param!");
			ws2.close();
		});

		ws2.on("error", (error) => {
			console.log("❌ Test 2: Error with TLS options as 2nd param:", error.message);
		});
	} catch (error) {
		console.log("❌ Test 2: Exception:", error.message);
	}
}, 2000);

// Wait 4 seconds
setTimeout(() => {
	// Test 3: With TLS options as 3rd parameter (CORRECT!)
	console.log("\n=== Test 3: TLS options as 3rd parameter (CORRECT) ===");

	try {
		const wsOptions = {
			rejectUnauthorized: false,
			minVersion: "TLSv1.2",
			maxVersion: "TLSv1.3",
		};

		const ws3 = new WebSocket(
			"wss://localhost:9001/?password=Pulinek1708",
			undefined,
			wsOptions
		);

		ws3.on("open", () => {
			console.log("✅ Test 3: Connected with TLS options as 3rd param!");
			ws3.close();
		});

		ws3.on("error", (error) => {
			console.log("❌ Test 3: Error with TLS options as 3rd param:", error.message);
		});
	} catch (error) {
		console.log("❌ Test 3: Exception:", error.message);
	}

	// Exit after 2 more seconds
	setTimeout(() => {
		console.log("\n=== Tests complete ===");
		process.exit(0);
	}, 2000);
}, 4000);
