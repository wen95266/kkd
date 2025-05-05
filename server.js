const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// --------------------------------------------------------------------
//                         1. Setup Express and Socket.IO             
// --------------------------------------------------------------------

// Initialize the Express app.
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Set up a static directory for serving client-side files.
app.use(express.static('public')); 

// Set up a basic route to render a basic HTML file with an id=“app”.
app.get('/', (req, res) => {
  // Use a simple HTML structure with an element with id="app"
    res.send(`
   <!DOCTYPE html>
    <html>
    <head><title>Dou Dizhu</title></head>
    <body>
        <div id="app"></div> 
    </body></html>`);
});

// --------------------------------------------------------------------
//                             2. Room Management                     
// --------------------------------------------------------------------

// Room Management
// Store room information
// roomId: { players: {}, deck: [], currentPlayerId: null, currentPlay: [], playerOrder: [], state: 'waiting', readyPlayers: 0, lastPlay: null, lastPlayPlayerId: null }
const rooms = {};

// 初始化固定房间
for (let i = 1; i <= 5; i++) {
    const roomId = i.toString();
    rooms[roomId] = {
        players: {},
        deck: [],
        currentPlayerId: null,
        currentPlay: [], // 当前桌面上的牌
        playerOrder: [],
        state: 'waiting', // 房间状态: waiting, ready, started, game_over
        readyPlayers: 0,
        lastPlay: null, // 上一回合出的牌
        lastPlayPlayerId: null, // 上一回合出牌的玩家 ID
        passedPlayers: 0, // 连续过牌玩家数量
    };
}

// --------------------------------------------------------------------
//                      3. Dou Dizhu Game Logic                       
// --------------------------------------------------------------------

// Dou Dizhu Game Logic:
// Initialize the deck
function initializeDeck() {
    const suits = ['C', 'D', 'H', 'S'];
    const ranks = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'];
    const deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ rank, suit });
        }
    }
     // 洗牌算法
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Deal cards (13 cards per player)
function dealCards(deck) {
    const hands = [[], [], [], []];
    for (let i = 0; i < deck.length; i++) {
        hands[i % 4].push(deck[i]);
    }
     const rankOrder = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'];
     // 花色 C < D < H < S
     const suitOrder = ['C', 'D', 'H', 'S'];
     for (const hand of hands) {
         hand.sort((a, b) => {
              const rankA = rankOrder.indexOf(a.rank);
              const rankB = rankOrder.indexOf(b.rank);
              if (rankA !== rankB) {
                  return rankA - rankB;
              }
              return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
         });
     }
    return hands;
}

// Check the card type and compare sizes
// Returns { valid: boolean, stronger: boolean, type: string } type: card type
function checkPlay(play, lastPlay) {
    // Empty cards, illegal
    if (play.length === 0) return { valid: false, stronger: false, type: 'none' };

    // TODO: 实现各种牌型的判断和比较逻辑
    // 返回牌型信息 (例如：'single', 'pair', 'triple', 'straight', 'flush', 'fullhouse', 'fourkind', 'straightflush')

    // 示例：简化为只判断单牌大小
    if (play.length === 1) {
         const rankOrder = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'];
         const suitOrder = ['C', 'D', 'H', 'S'];
         const rankA = rankOrder.indexOf(play[0].rank);

         if (lastPlay && lastPlay.length === 1) {
             const rankB = rankOrder.indexOf(lastPlay[0].rank);
             if (rankA > rankB) return { valid: true, stronger: true, type: 'single' };
             if (rankA < rankB) return { valid: true, stronger: false, type: 'single' };
             const suitA = suitOrder.indexOf(play[0].suit);
             const suitB = suitOrder.indexOf(lastPlay[0].suit);
             return { valid: true, stronger: suitA > suitB, type: 'single' };
         } else if (!lastPlay || lastPlay.length === 0) {
             return { valid: true, stronger: true, type: 'single' }; // 第一个出牌
         }
    }

    // TODO: Add other card type judgments and comparisons

    // Default illegal card type
    return { valid: false, stronger: false, type: 'unknown' };
}

// --------------------------------------------------------------------
//                        4. Socket.IO Events                          
// --------------------------------------------------------------------

// Socket.IO connection event handling
io.on('connection', (socket) => {
    console.log('A user connected：', socket.id);

    let currentRoomId = null; // Store the ID of the room the player is currently in

    // Broadcast room list update
    socket.emit('room_list', Object.keys(rooms).map(roomId => ({ id: roomId, players: Object.keys(rooms[roomId].players).length })));


   // 玩家请求加入房间
  socket.on('join_room', (roomId) => {
        if (socket.rooms.has(roomId)) {
             socket.emit('error', '您已在该房间中');
             return;
        }
       
        // 检查房间号是否有效
       if (!rooms[roomId]) {
            socket.emit('error', '房间号无效');
            return;
       }
       const room = rooms[roomId];
        const playerIdsInRoom = Object.keys(room.players);

        if (playerIdsInRoom.length >= 4) {
             socket.emit('error', '房间已满');
             return;
        }

        // 检查房间是否已经在游戏中
        if (room.state === 'started') {
             socket.emit('spectating', { message: '游戏已开始，您正在观战或等待下一局' });
             // 可以发送当前游戏状态给观战者
        }

        
       // 加入 Socket.IO 房间
       socket.join(roomId);
       currentRoomId = roomId;

       // 添加玩家到房间
       room.players[socket.id] = {
            id: socket.id,
            hand: [],
            position: null,
            ready: false, // Player ready state
       };

        // 分配座位
        const availablePositions = ['bottom', 'left', 'top', 'right'].filter(pos => !Object.values(room.players).some(p => p.position === pos));
        if (availablePositions.length > 0) {
            room.players[socket.id].position = availablePositions[0];
            socket.emit('seat_assigned', room.players[socket.id].position);
        }


       console.log(`用户 ${socket.id} 加入房间 ${roomId}`);

        // 通知房间内所有玩家玩家列表更新
        //更新玩家列表
        io.to(roomId).emit('player_list_updated', Object.values(room.players).map(p => ({ id: p.id, position: p.position, ready: p.ready })));

        // 成功加入房间的反馈
        socket.emit('joined_room', { roomId: roomId });

 });


   // 玩家请求准备
    socket.on('player_ready', () => {
       if (!currentRoomId || !rooms[currentRoomId]) {
            socket.emit('error', '您不在任何房间中');
            return;
       }
       const room = rooms[currentRoomId];

       if (!room.players[socket.id]) {
             socket.emit('error', '您不在房间玩家列表中');
             return;
       }

        if (room.players[socket.id].ready) {
             socket.emit('error', '您已经准备了');
             return;
        }

       room.players[socket.id].ready = true;
       room.readyPlayers++;
        room.state = 'ready'; // Room status changes to ready

       io.to(currentRoomId).emit('player_ready_status', { playerId: socket.id, ready: true });

       console.log(`玩家 ${socket.id} 在房间 ${currentRoomId} 准备就绪，当前 ${room.readyPlayers} 人准备`);

       // 如果房间已满且所有玩家都准备就绪，自动开始游戏
        if (Object.keys(room.players).length === 4 && room.readyPlayers === 4 && room.state === 'ready') {
             startGame(currentRoomId);
        }
    });


    // 开始游戏
    // Start the game logic (now accepting roomId parameter)
    function startGame(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        room.state = 'started';
        const playerIdsInRoom = Object.keys(room.players);

        room.deck = initializeDeck();
        const hands = dealCards(room.deck);

        let startPlayerId = null;

        playerIdsInRoom.forEach((id, index) => {
            room.players[id].hand = hands[index];
            if (room.players[id].hand.some(card => card.rank === '3' && card.suit === 'H')) {
                startPlayerId = id;
            }
            io.to(id).emit('your_hand', room.players[id].hand);
        });

        room.playerOrder = playerIdsInRoom;
        const startIndex = room.playerOrder.indexOf(startPlayerId);
        room.playerOrder = room.playerOrder.slice(startIndex).concat(room.playerOrder.slice(0, startIndex));

        room.currentPlayerId = room.playerOrder[0];
        room.currentPlay = [];
        room.lastPlay = null; // 重置上一回合出的牌
        room.lastPlayPlayerId = null; // 重置上一回合出牌玩家
        room.passedPlayers = 0; // 重置连续过牌玩家计数

        io.to(roomId).emit('game_started', {
            startPlayerId: room.currentPlayerId,
            players: Object.values(room.players).map(p => ({ id: p.id, position: p.position, handSize: p.hand.length })),
            playerOrder: room.playerOrder
        });
   }


   // Player play cards logic
   // Player play cards
    socket.on('play_cards', (cards) => {
        if (!currentRoomId || !rooms[currentRoomId]) {
             socket.emit('error', '您不在任何房间中');
             return;
        }
        const room = rooms[currentRoomId];

        if (socket.id !== room.currentPlayerId || room.state !== 'started') {
            socket.emit('error', '现在不是你的回合或游戏未开始');
            return;
        }

         if (!Array.isArray(cards) || cards.length === 0) {
             socket.emit('error', '请选择要出的牌');
             return;
         }

        // 检查玩家手牌是否包含要出的牌
        const playerHandRanks = room.players[socket.id].hand.map(card => `${card.rank}${card.suit}`);
        const validPlayInHand = cards.every(card =>
             playerHandRanks.includes(`${card.rank}${card.suit}`)
        );


        if (!validPlayInHand) {
            socket.emit('error', '你没有这些牌');
            return;
        }

        // 检查牌型是否合法且大于桌面上的牌
        const playCheck = checkPlay(cards, room.currentPlay);

        if (!playCheck.valid) {
             socket.emit('error', '出的牌不合法');
             return;
        }

         if (room.currentPlay && room.currentPlay.length > 0 && !playCheck.stronger) {
              socket.emit('error', '出的牌不够大');
              return;
         }


        // 从玩家手牌中移除出的牌
        for (const card of cards) {
            const index = room.players[socket.id].hand.findIndex(hCard => hCard.rank === card.rank && hCard.suit === card.suit);
            if (index !== -1) {
                room.players[socket.id].hand.splice(index, 1);
            }
        }

        room.currentPlay = cards; // 更新桌面上的牌
        room.lastPlay = cards; // 更新上一回合出的牌
        room.lastPlayPlayerId = socket.id; // 更新上一回合出牌玩家
        room.passedPlayers = 0; // 重置连续过牌计数

        io.to(currentRoomId).emit('cards_played', { playerId: socket.id, play: cards, handSize: room.players[socket.id].hand.length }); // 通知房间内所有玩家出的牌

        // 检查游戏是否结束
        if (room.players[socket.id].hand.length === 0) {
             io.to(currentRoomId).emit('game_over', { winnerId: socket.id });
             room.state = 'game_over';
             // TODO: 计算得分等结束逻辑
         } else {
             // It's the next player's turn
             const currentIndex = room.playerOrder.indexOf(room.currentPlayerId);
             room.currentPlayerId = room.playerOrder[(currentIndex + 1) % room.playerOrder.length];
              io.to(currentRoomId).emit('next_turn', { playerId: room.currentPlayerId });
         }

   });

    // 玩家过牌逻辑
    // 玩家过牌
    socket.on('pass_turn', () => {
         if (!currentRoomId || !rooms[currentRoomId]) {
             socket.emit('error', '您不在任何房间中');
             return;
        }
        const room = rooms[currentRoomId];

        if (socket.id !== room.currentPlayerId || room.state !== 'started') {
            socket.emit('error', '现在不是你的回合或游戏未开始');
            return;
        }

        // You can only pass when there are cards on the table
         if (!room.currentPlay || room.currentPlay.length === 0) {
              socket.emit('error', '你是第一个出牌，不能过牌');
              return;
         }

        io.to(currentRoomId).emit('player_passed', { playerId: socket.id }); // Notify the player to pass

        room.passedPlayers++; // 增加连续过牌计数

        // Determine whether the round is over (everyone has passed except the player who played the cards)
         const playersInRoomCount = Object.keys(room.players).length;
         if (room.passedPlayers === playersInRoomCount - 1) {
              console.log(`房间 ${currentRoomId} 一轮结束，清空桌面`);
              room.currentPlay = []; // 清空桌面上的牌
              room.lastPlay = null; // 清空上一回合出的牌
              room.lastPlayPlayerId = null; // 清空上一回合出牌玩家
              room.passedPlayers = 0; // 重置连续过牌计数

              // It's the turn of the last player to start a new round
               if (room.lastPlayPlayerId) {
                    room.currentPlayerId = room.lastPlayPlayerId;
                    console.log(`房间 ${currentRoomId} 新一轮由上一个出牌玩家 ${room.currentPlayerId} 开始`);
               } else {
                    // This should not happen in theory, but as a backup, it is the next one to the current player
                    const currentIndex = room.playerOrder.indexOf(room.currentPlayerId);
                     room.currentPlayerId = room.playerOrder[(currentIndex + 1) % room.playerOrder.length];
               }

               // 通知客户端清空桌面牌并更新回合
              io.to(currentRoomId).emit('round_ended'); // 新增事件通知客户端一轮结束
              io.to(currentRoomId).emit('next_turn', { playerId: room.currentPlayerId });

         } else {
             // Next player's turn
             const currentIndex = room.playerOrder.indexOf(room.currentPlayerId); 
             room.currentPlayerId = room.playerOrder[(currentIndex + 1) % room.playerOrder.length];
              io.to(currentRoomId).emit('next_turn', { playerId: room.currentPlayerId });
         }
    });

    // 重置游戏逻辑
    // Reset game state (now accepting roomId parameter)
    function resetGame(roomId) { 
        const room = rooms[roomId];
         if (!room) return;

        room.currentPlayerId = null;
        room.currentPlay = [];
        room.playerOrder = [];
        room.state = 'waiting';
        room.readyPlayers = 0;
        room.lastPlay = null;
        room.lastPlayPlayerId = null;
        room.passedPlayers = 0;

         for (const playerId in room.players) {
             room.players[playerId].hand = [];
             room.players[playerId].ready = false;
         }
        io.to(roomId).emit('game_reset');
         io.to(roomId).emit('player_list_updated', Object.values(room.players).map(p => ({ id: p.id, position: p.position, ready: p.ready })));
    }

     // 玩家请求重置游戏
    socket.on('request_reset', () => {
         if (!currentRoomId || !rooms[currentRoomId]) {
             socket.emit('error', '您不在任何房间中');
             return;
        }
         resetGame(currentRoomId);
    });


    // 玩家断开连接逻辑
    socket.on('disconnect', () => {
    console.log('用户断开连接：', socket.id);

     if (currentRoomId && rooms[currentRoomId]) {
         const room = rooms[currentRoomId];

         if (room.players[socket.id]?.ready) {
             room.readyPlayers--;
         }

         const position = room.players[socket.id]?.position;
         delete room.players[socket.id];

          // 从玩家顺序中移除断开连接的玩家
          room.playerOrder = room.playerOrder.filter(id => id !== socket.id);

         if (position) {
             io.to(currentRoomId).emit('player_left', { id: socket.id, position: position });
         }

         io.to(currentRoomId).emit('player_list_updated', Object.values(room.players).map(p => ({ id: p.id, position: p.position, ready: p.ready })));


         // 如果断开连接的是当前玩家，轮到下一个
         if (room.currentPlayerId === socket.id && room.state === 'started') {
              const playerIdsInRoom = Object.keys(room.players);
              if (playerIdsInRoom.length > 0) {
                   const currentIndex = room.playerOrder.indexOf(room.currentPlayerId); // 使用更新后的 playerOrder
                    // 找到断开连接玩家在顺序中的下一个有效玩家
                   let nextIndex = (currentIndex + 1) % room.playerOrder.length;
                    while (!room.players[room.playerOrder[nextIndex]] && Object.keys(room.players).length > 0) {
                         nextIndex = (nextIndex + 1) % room.playerOrder.length;
                         // 如果遍历一圈回到当前位置且玩家仍不存在，说明房间已空
                          if (nextIndex === currentIndex) break;
                    }
                    if (room.players[room.playerOrder[nextIndex]]) {
                        room.currentPlayerId = room.playerOrder[nextIndex];
                        io.to(currentRoomId).emit('next_turn', { playerId: room.currentPlayerId });
                    } else {
                        // 房间内没有玩家了，重置房间
                        resetGame(currentRoomId);
                         delete rooms[currentRoomId]; // 删除空房间
                         console.log(`房间 ${currentRoomId} 已删除 (所有玩家离开)`);
                    }

              } else {
                   // 房间内没有玩家了，重置房间
                   resetGame(currentRoomId);
                    delete rooms[currentRoomId]; // 删除空房间
                    console.log(`房间 ${currentRoomId} 已删除 (所有玩家离开)`);
              }
         }


          // 如果断开连接导致房间玩家不足，且游戏已开始，结束游戏并重置房间
          if (room.state === 'started' && Object.keys(room.players).length < 4) {
               console.log(`房间 ${currentRoomId} 玩家不足，游戏结束`);
               io.to(currentRoomId).emit('game_over', { winnerId: null, message: '玩家不足，游戏结束' });
                resetGame(currentRoomId);
          }

          // 如果房间空了，删除房间
           if (Object.keys(room.players).length === 0) {
                delete rooms[currentRoomId];
                console.log(`房间 ${currentRoomId} 已删除`);
           }

     }

     });
});

// --------------------------------------------------------------------
//                   5. Start the server                              
// --------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});