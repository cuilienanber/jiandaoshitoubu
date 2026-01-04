const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const HTTP_PORT = 3000;
const WS_PORT = 8080;

const rooms = new Map();

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
    console.log('新玩家连接');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'joinRoom':
                    handleJoinRoom(ws, data);
                    break;
                case 'makeChoice':
                    handleMakeChoice(ws, data);
                    break;
                case 'resetGame':
                    handleResetGame(ws, data);
                    break;
                case 'disconnect':
                    handleDisconnect(ws);
                    break;
            }
        } catch (error) {
            console.error('消息处理错误:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
    });
});

function handleJoinRoom(ws, data) {
    const roomKey = data.roomKey;
    
    if (!roomKey) {
        sendToPlayer(ws, {
            type: 'error',
            message: '请输入房间密钥'
        });
        return;
    }

    const room = rooms.get(roomKey);

    if (!room) {
        const newRoom = {
            key: roomKey,
            player1: ws,
            player2: null,
            player1Choice: null,
            player2Choice: null,
            player1Ready: false,
            player2Ready: false
        };

        rooms.set(roomKey, newRoom);
        ws.roomKey = roomKey;
        ws.playerNumber = 1;

        sendToPlayer(ws, {
            type: 'roomJoined',
            roomKey: roomKey,
            playerNumber: 1,
            message: '已创建房间，等待对手加入...'
        });

        console.log(`房间 ${roomKey} 创建成功，等待玩家2`);
    } else {
        if (room.player2) {
            sendToPlayer(ws, {
                type: 'error',
                message: '房间已满'
            });
            return;
        }

        room.player2 = ws;
        ws.roomKey = roomKey;
        ws.playerNumber = 2;

        sendToPlayer(room.player1, {
            type: 'opponentJoined',
            playerNumber: 2,
            message: '对手已加入，游戏开始！'
        });

        sendToPlayer(ws, {
            type: 'roomJoined',
            roomKey: roomKey,
            playerNumber: 2,
            message: '已加入房间，游戏开始！'
        });

        console.log(`房间 ${roomKey} 玩家2加入成功`);
    }
}

function handleMakeChoice(ws, data) {
    const roomKey = ws.roomKey;
    const room = rooms.get(roomKey);

    if (!room) return;

    if (ws.playerNumber === 1) {
        room.player1Choice = data.choice;
        room.player1Ready = true;
    } else {
        room.player2Choice = data.choice;
        room.player2Ready = true;
    }

    if (room.player1Ready && room.player2Ready) {
        const result = determineWinner(room.player1Choice, room.player2Choice);

        sendToPlayer(room.player1, {
            type: 'gameResult',
            player1Choice: room.player1Choice,
            player2Choice: room.player2Choice,
            result: result
        });

        sendToPlayer(room.player2, {
            type: 'gameResult',
            player1Choice: room.player1Choice,
            player2Choice: room.player2Choice,
            result: result
        });

        console.log(`房间 ${roomKey} 游戏结束: ${result}`);
    } else {
        const opponent = ws.playerNumber === 1 ? room.player2 : room.player1;
        sendToPlayer(opponent, {
            type: 'opponentReady'
        });
    }
}

function handleResetGame(ws, data) {
    const roomKey = ws.roomKey;
    const room = rooms.get(roomKey);

    if (!room) return;

    if (ws.playerNumber === 1) {
        room.player1Ready = false;
    } else {
        room.player2Ready = false;
    }

    if (!room.player1Ready && !room.player2Ready) {
        room.player1Choice = null;
        room.player2Choice = null;

        sendToPlayer(room.player1, {
            type: 'gameReset'
        });

        sendToPlayer(room.player2, {
            type: 'gameReset'
        });

        console.log(`房间 ${roomKey} 游戏重置`);
    }
}

function handleDisconnect(ws) {
    const roomKey = ws.roomKey;
    if (!roomKey) return;

    const room = rooms.get(roomKey);
    if (!room) return;

    const opponent = ws.playerNumber === 1 ? room.player2 : room.player1;

    if (opponent && opponent.readyState === WebSocket.OPEN) {
        sendToPlayer(opponent, {
            type: 'opponentDisconnected'
        });
    }

    rooms.delete(roomKey);
    console.log(`房间 ${roomKey} 玩家断开连接`);
}

function determineWinner(choice1, choice2) {
    if (choice1 === choice2) {
        return 'draw';
    }

    if (
        (choice1 === '剪刀' && choice2 === '布') ||
        (choice1 === '石头' && choice2 === '剪刀') ||
        (choice1 === '布' && choice2 === '石头')
    ) {
        return 'player1';
    }

    return 'player2';
}

function sendToPlayer(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`HTTP服务器运行在 http://0.0.0.0:${HTTP_PORT}`);
    console.log(`WebSocket服务器运行在 ws://0.0.0.0:${WS_PORT}`);
    console.log(`本地访问: http://localhost:${HTTP_PORT}`);
    console.log(`局域网访问: http://<本机IP>:${HTTP_PORT}`);
});