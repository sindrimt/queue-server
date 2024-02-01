const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const fetch = require("node-fetch");

app.use(cors());
app.use(express.json());

const queues = {};
const activeChats = {};

// Import fetch at the top of your file

// Function to fetch the number of active Intercom chats
const fetchIntercomActiveChats = async (platform) => {
    try {
        const resp = await fetch(`https://api.intercom.io/conversations/search`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Intercom-Version": "2.10",
                Authorization: "Bearer dG9rOjZiYWIyNzJhX2IwZjhfNDk5NF9hM2JiX2UxOTBhYTQwZTZiOToxOjA=",
            },
            body: JSON.stringify({
                query: {
                    operator: "AND",
                    value: [
                        {
                            field: "team_assignee_id",
                            operator: "=",
                            value: "6830300", // Live chats
                        },
                        {
                            field: "open",
                            operator: "=",
                            value: "true",
                        },
                    ],
                },
            }),
        });

        const data = await resp.json();
        console.log(data.total_count);
        // Assuming the data object has a total count of conversations, adjust based on actual API response structure
        return data.total_count || 0;
    } catch (error) {
        console.error("Error fetching active chats from Intercom:", error);
        return 0; // Return 0 in case of error to avoid blocking chat functionality
    }
};

const tryStartChat = (platform) => {
    while (queues[platform] && queues[platform].length > 0 && (activeChats[platform] || 0) < 5) {
        const userToStartChat = queues[platform].shift();
        if (userToStartChat.ws) {
            userToStartChat.ws.send(JSON.stringify({ message: "Your live chat session has started" }));
            activeChats[platform] = (activeChats[platform] || 0) + 1;
        }
    }
    notifyQueueUpdate(platform);
};

const notifyQueueUpdate = (platform) => {
    if (queues[platform]) {
        queues[platform].forEach((user, index) => {
            if (user.ws) {
                user.ws.send(JSON.stringify({ message: "Queue update", position: index + 1 }));
            }
        });
    }
};

wss.on("connection", (ws, req) => {
    const queryParams = new URLSearchParams(req.url?.split("?")[1]);
    const userId = queryParams.get("userId");
    const platform = queryParams.get("platform");

    if (!queues[platform]) {
        queues[platform] = [];
    }

    let addedToActiveChat = false;

    if ((activeChats[platform] || 0) < 5) {
        activeChats[platform] = (activeChats[platform] || 0) + 1;
        addedToActiveChat = true;
        ws.send(JSON.stringify({ message: "Your live chat session has started immediately" }));
    } else {
        queues[platform].push({ userId, ws });
        notifyQueueUpdate(platform);
        ws.send(JSON.stringify({ message: "Added to queue", position: queues[platform].length }));
    }

    ws.on("close", () => {
        if (addedToActiveChat && activeChats[platform]) {
            // User was part of active chats
            activeChats[platform]--;
        } else {
            // User was in the queue
            const index = queues[platform].findIndex((user) => user.userId === userId);
            if (index !== -1) {
                queues[platform].splice(index, 1);
            }
        }
        tryStartChat(platform);
        notifyQueueUpdate(platform);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// app.post("/enqueue", (req, res) => {
//     const { userId, platform } = req.body;

//     if (!queues[platform]) {
//         queues[platform] = [];
//     }

//     if ((activeChats[platform] || 0) < 5) {
//         activeChats[platform] = (activeChats[platform] || 0) + 1;
//         res.json({ message: "Chat started immediately" });
//     } else {
//         queues[platform].push({ userId, ws: null });
//         notifyQueueUpdate(platform);
//         res.json({ message: "Added to queue", position: queues[platform].length });
//     }
// });

// app.post("/dequeue", (req, res) => {
//     const { userId, platform } = req.body;

//     // Check if the user is in active chats
//     if (activeChats[platform] && activeChats[platform] > 0) {
//         // If the user is in active chats, decrement the count and try to start a new chat
//         activeChats[platform]--;
//         tryStartChat(platform);
//         res.json({ message: "User removed from active chats", userId: userId });
//     } else {
//         // Check if the user is in the queue
//         if (queues[platform]) {
//             const index = queues[platform].findIndex((user) => user.userId === userId);
//             if (index !== -1) {
//                 queues[platform].splice(index, 1);
//                 notifyQueueUpdate(platform);
//                 res.json({ message: "User dequeued", userId: userId });
//             } else {
//                 res.status(404).json({ message: "User not found in queue" });
//             }
//         } else {
//             res.status(404).json({ message: "Platform not found" });
//         }
//     }
// });
