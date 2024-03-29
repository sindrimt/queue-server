const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
// Dynamic import of node-fetch
let fetch;
import("node-fetch")
    .then(({ default: nodeFetch }) => {
        fetch = nodeFetch;
    })
    .catch((err) => console.error("Failed to load node-fetch:", err));

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const dotenv = require("dotenv");
dotenv.config();

app.use(cors());
app.use(express.json());

const queues = {};
let activeChatsCount = {}; // Holds the number of active chats from Intercom for each platform
const queueLimit = parseInt(process.env.QUEUE_LIMIT); // Limit the number of people in the queue

// Function to fetch the number of active Intercom chats and update everyone in the queue
const fetchAndUpdateActiveChats = async (platform) => {
    console.log("Started fetch");
    try {
        const resp = await fetch(`https://api.intercom.io/conversations/search`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.INTERCOM_TOKEN}`,
                "Intercom-Version": "2.10",
            },
            body: JSON.stringify({
                query: {
                    operator: "AND",
                    value: [
                        {
                            field: "open",
                            operator: "=",
                            value: "true",
                        },
                        {
                            field: "team_assignee_id",
                            operator: "=",
                            value: process.env.INTERCOM_TEAM_ID,
                        },
                        {
                            field: "admin_assignee_id",
                            operator: "=",
                            value: "0",
                        },
                    ],
                },
            }),
        });

        const data = await resp.json();
        console.log(data.total_count);

        activeChatsCount[platform] = data.total_count || 0;
    } catch (error) {
        console.error("Error fetching active chats from Intercom:", error);
        activeChatsCount[platform] = 0;
    }
    notifyAllUsersInQueue(platform); // Notify all users in queue about their new position
};

// Update and notify periodically
const updateActiveChatsPeriodically = (platform) => {
    fetchAndUpdateActiveChats(platform);
    setInterval(() => fetchAndUpdateActiveChats(platform), 5000); // Update every minute
};

const notifyQueueUpdate = (platform) => {
    if (queues[platform]) {
        queues[platform].forEach((user, index) => {
            if (user.ws) {
                // Calculate the user's position in the queue
                const positionInQueue = index + 1; // Adding 1 to make it human-readable (1-based index)
                const totalActiveAndWaiting = activeChatsCount[platform] + positionInQueue;

                console.log(parseInt(process.env.QUEUE_LIMIT));

                // If the user's position in the queue effectively places them within the active chats limit
                if (totalActiveAndWaiting <= queueLimit) {
                    user.ws.send(JSON.stringify({ message: "Your live chat session has started immediately", positionInQueue: 0 }));
                } else {
                    // Calculate how many people are ahead in the queue, considering active chats
                    const peopleAhead = Math.max(0, totalActiveAndWaiting - process.env.QUEUE_LIMIT);
                    user.ws.send(
                        JSON.stringify({
                            message: `Your position in the queue is: ${positionInQueue}. There are ${peopleAhead} people in front of you.`,
                            positionInQueue,
                        })
                    );
                }
            }
        });
    }
};

// New function to notify all users in a queue, not just on updates
const notifyAllUsersInQueue = (platform) => {
    notifyQueueUpdate(platform); // Re-use existing logic for notifying users
};

wss.on("connection", (ws, req) => {
    const queryParams = new URLSearchParams(req.url?.split("?")[1]);
    const userId = queryParams.get("userId");
    const platform = queryParams.get("platform");

    if (!queues[platform]) {
        queues[platform] = [];
        updateActiveChatsPeriodically(platform); // Start updating active chats periodically for this platform
    }

    fetchAndUpdateActiveChats(platform).then(() => {
        // After fetching, decide whether to queue the user or start chat
        let addedToActiveChat = false;
        // If active chats are less than 40, or adjusting logic based on new requirements
        if (activeChatsCount[platform] <= queueLimit) {
            // Directly start chat
            addedToActiveChat = true;
            ws.send(JSON.stringify({ message: "Your live chat session has started immediately" }));
        } else {
            // Add to queue and notify
            queues[platform].push({ userId, ws });
            notifyQueueUpdate(platform); // This will now correctly inform them of the number of people ahead
        }

        ws.on("close", () => {
            const index = queues[platform].findIndex((user) => user.userId === userId);
            if (addedToActiveChat) {
                // Fetch latest active chats count to ensure accuracy, no decrement needed here
                fetchAndUpdateActiveChats(platform);
            } else if (index !== -1) {
                queues[platform].splice(index, 1);
                notifyAllUsersInQueue(platform); // Notify everyone in queue about the update
            }
        });
    });
});

process.on("uncaughtException", (err) => {
    console.error("Unhandled Exception", err);
    // Consider graceful shutdown and restart
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection", reason);
    // Consider graceful shutdown and restart
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
