const WebSocket = require("ws");

// Check if a userId is provided as a command-line argument
const userIdArg = process.argv[2];
const userId = userIdArg || "default-user"; // Provide a default value if no userId is provided

const platform = "test-platform";
const wsUrl = `ws://localhost:3000?userId=${userId}&platform=${platform}`;
const ws = new WebSocket(wsUrl);

ws.on("open", function open() {
    console.log("Connected to the server");
});

ws.on("message", function incoming(data) {
    console.log("Received:", data);
});

ws.on("close", function close() {
    console.log("Disconnected from the server");
});

// You can also send messages to the server if needed
// ws.send('your message');
