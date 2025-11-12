import socket from "../socket";
import storage from "../localStorage";

socket.on("token", (token: string) => {
	storage.set("token", token);
});
