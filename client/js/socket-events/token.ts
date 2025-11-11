import socket from "../socket";
import storage from "../localStorage";

socket.on("token", (token: string) => {
	console.log("[TOKEN] Received token from server, saving to localStorage");
	storage.set("token", token);
	console.log("[TOKEN] Token saved, verification:", storage.get("token") ? "SUCCESS" : "FAILED");
});
