const express = require("express");
const http = require("http");
const socketio = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

let users = {};
let pendingRequests = {};

let restartTimeout;

io.on('connection', (socket) => {
    console.log(`${socket.id} connected`);

    socket.on('setUserID', (userID) => {
        try {
            socket.userID = userID;
            users[userID] = socket.id;
        } catch (error) {
            handleError(error, socket, 'Internal server error occurred.');
        }
    });


    // Inside the 'checkAndConnect' event listener
    socket.on('checkAndConnect', (recipientID) => {
        try {
            // Check if the recipientID is a valid format (in this case, a 6-digit number)
            if (!/^\d{6}$/.test(recipientID)) {
                throw new Error('Invalid recipient ID format.');
            }

            const recipientSocket = io.sockets.sockets[users[recipientID]];
            if (recipientSocket) {
                sendConnectionRequest(recipientSocket, socket.userID);
            } else {
                socket.emit('error', 'Recipient ID not found or not connected.');
            }
        } catch (error) {
            console.error('Error checking and connecting:', error);
            socket.emit('error', 'Invalid recipient ID.');
        }
    });



    // Helper function to send connection request
    const sendConnectionRequest = (recipientSocket, senderID) => {
        try {
            pendingRequests[recipientSocket.userID] = setTimeout(() => {
                delete pendingRequests[recipientSocket.userID];
                recipientSocket.emit('error', 'Connection request timed out.');
            }, 15000);
            recipientSocket.emit('connectionRequest', { senderID });
        } catch (error) {
            console.error('Error sending connection request:', error);
            socket.emit('error', 'Internal server error occurred.');
        }
    };

    socket.on('acceptConnection', (senderID) => {
        try {
            clearTimeout(pendingRequests[socket.userID]);
            io.to(users[senderID]).emit('userConnected', socket.userID);
            io.to(socket.id).emit('userConnected', senderID);
        } catch (error) {
            console.error('Error accepting connection:', error);
            socket.emit('error', 'Internal server error occurred.');
        }
    });

    // Function to send messages
    const sendMessageToRecipient = (recipientID, message) => {
        try {
            const recipientSocket = io.sockets.sockets[users[recipientID]];
            if (recipientSocket) {
                recipientSocket.emit('message', { userID: socket.userID, message });
            } else {
                socket.emit('error', 'Recipient ID not found or not connected.');
            }
        } catch (error) {
            console.error('Error sending message to recipient:', error);
            socket.emit('error', 'Internal server error occurred.');
        }
    };

    socket.on('sendMessage', (recipientID, message) => {
        sendMessageToRecipient(recipientID, message);
    });

    // Inside io.on('connection', ...) event listener
    socket.on('disconnectUser', () => {
        try {
            // Remove the user from the users object
            delete users[socket.userID];
            // Optionally, perform any additional cleanup tasks
        } catch (error) {
            console.error('Error disconnecting user:', error);
        }
    });


    socket.on('disconnect', () => {
        console.log(`${socket.id} disconnected`);
        try {
            delete users[socket.userID];
        } catch (error) {
            console.error('Error handling disconnect event:', error);
            // It's fine if user ID doesn't exist in users object
        }
    });
});

// Global error handling middleware for Express
app.use((err, req, res, next) => {
    console.error('Global Express error handler:', err);
    res.status(500).send('Internal server error occurred.');
    // Notify all connected users about the error
    io.emit('serverError', 'Internal server error occurred.');
    // Restart server after 1 second
    if (!restartTimeout) {
        restartTimeout = setTimeout(restartServer, 1000);
    }
});

// Global error handling for Socket.IO
io.on('error', (err) => {
    console.error('Global Socket.IO error handler:', err);
    // Notify all connected users about the error
    io.emit('serverError', 'Internal server error occurred.');
    // Restart server after 1 second
    if (!restartTimeout) {
        restartTimeout = setTimeout(restartServer, 1000);
    }
});

function restartServer() {
    console.log('Restarting server...');
    io.emit('serverRestarting', 'Server is restarting...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
}

function handleError(error, socket, errorMessage) {
    console.error('Error:', error);
    socket.emit('error', errorMessage);
}

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/html/index.html");
});

const port = process.env.PORT || 3002;
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});