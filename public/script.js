const socket = io();
const roomSelect = document.getElementById('roomSelect');

    
// --------------------------------------------------------------------
//                   1. Game client initialization
// --------------------------------------------------------------------

let currentRoomId = null;
let myPlayerId = null;

const handDiv = document.getElementById('player-hand');
const playButton = document.getElementById('play-button');
const passButton = document.getElementById('pass-button');
const readyButton = document.getElementById('ready-button');
const resetButton = document.getElementById('reset-button');
const roomListDiv = document.getElementById('room-list');


// --------------------------------------------------------------------
//                      2. Client event handling
// --------------------------------------------------------------------


socket.on('connect', () => {
    console.log('Connected to server');
    myPlayerId = socket.id;
});

// Update room list
socket.on('room_list', (rooms) => {
    roomListDiv.innerHTML = '<h2>房间列表</h2>';
    rooms.forEach(room => {
        const roomItem = document.createElement('div');
        roomItem.innerHTML = `房间 ${room.id} (玩家：${room.players})`;
        roomItem.onclick = () => {
            selectRoom(room.id);
        };
        roomListDiv.appendChild(roomItem);
    });
});

// Join room response
socket.on('joined_room', (data) => {
    currentRoomId = data.roomId;
    roomSelect.value = currentRoomId;
    console.log(`Joined room ${currentRoomId}`);
    document.getElementById('room-id-display').textContent = `房间号: ${currentRoomId}`;
});


// Player list update
socket.on('player_list_updated', (players) => {
    console.log('player_list_updated:', players);
    updatePlayerDisplay(players);
});

// Seat assignment
socket.on('seat_assigned', (position) => {
    console.log(`Seat assigned: ${position}`);
    document.getElementById('my-position').textContent = `你的位置: ${position}`;
});

// Player ready status
socket.on('player_ready_status', (data) => {
    console.log('player_ready_status:', data);
    const playerDiv = document.getElementById(`player-${data.playerId}`);
    if (playerDiv) {
        playerDiv.classList.toggle('ready', data.ready);
    }
});

//Game start
socket.on('game_started', (data) => {
    console.log('Game started:', data);
    document.getElementById('game-message').textContent = `游戏已开始，轮到 ${data.startPlayerId} 出牌`;
});

socket.on('your_hand', (hand) => {
    console.log('Your hand:', hand);
    displayHand(hand);
});

//Card play
socket.on('cards_played', (data) => {
    console.log(`Player ${data.playerId} played cards:`, data.play);
    updateHandSize(data.playerId, data.handSize);
    document.getElementById('last-play').textContent = `${data.playerId} 出牌: ${JSON.stringify(data.play)}`;
});

// Next turn
socket.on('next_turn', (data) => {
    console.log(`Next turn: ${data.playerId}`);
    if (data.playerId === myPlayerId) {
        document.getElementById('game-message').textContent = '轮到你出牌';
        playButton.disabled = false;
        passButton.disabled = false;
    } else {
        document.getElementById('game-message').textContent = `轮到 ${data.playerId} 出牌`;
        playButton.disabled = true;
        passButton.disabled = true;
    }
});

//Player pass
socket.on('player_passed', (data) => {
    console.log(`Player ${data.playerId} passed`);
    document.getElementById('last-play').textContent = `${data.playerId} 过`;
});

//Round end
socket.on('round_ended', () => {
    console.log('Round ended');
    document.getElementById('last-play').textContent = '新一轮开始';
});

//Game over
socket.on('game_over', (data) => {
    console.log('Game over:', data);
    if (data.winnerId) {
        document.getElementById('game-message').textContent = `游戏结束，赢家是 ${data.winnerId}`;
    } else {
        document.getElementById('game-message').textContent = `游戏结束，${data.message}`;
    }

    playButton.disabled = true;
    passButton.disabled = true;
});


// Handle disconnection
socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Handle errors
socket.on('error', (message) => {
    console.error('Error:', message);
    alert(message);
});

// Handle spectating
socket.on('spectating', (data) => {
    console.log('Spectating:', data);
    alert(data.message);
});

// Handle player left
socket.on('player_left', (data) => {
    console.log(`Player ${data.id} left from position ${data.position}`);
    document.getElementById(`player-${data.id}`).remove();
});

//Handle game reset
socket.on('game_reset', () => {
    console.log('Game reset');
    document.getElementById('game-message').textContent = '游戏已重置，请重新准备';
    document.getElementById('last-play').textContent = '';
    clearHand();
});

// --------------------------------------------------------------------
//                          3. Function
// --------------------------------------------------------------------

function selectRoom(roomId) {
    console.log(`Joining room ${roomId}`);
    socket.emit('join_room', roomId);
}

function displayHand(hand) {
    clearHand();
    hand.forEach(card => {
        const cardDiv = document.createElement('div');
        cardDiv.textContent = `${card.suit} ${card.rank}`;
        cardDiv.className = 'card';
        cardDiv.onclick = () => {
            cardDiv.classList.toggle('selected');
        };
        handDiv.appendChild(cardDiv);
    });
}

function clearHand() {
    handDiv.innerHTML = '';
}

function getSelectedCards() {
    const selectedCards = [];
    const cardDivs = handDiv.querySelectorAll('.card.selected');
    cardDivs.forEach(div => {
        const [suit, rank] = div.textContent.split(' ');
        selectedCards.push({ suit, rank });
    });
    return selectedCards;
}

function updatePlayerDisplay(players) {
    const positions = ['top', 'left', 'right', 'bottom'];
    const playerDisplayDiv = document.getElementById('player-display');
    playerDisplayDiv.innerHTML = '';
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.id = `player-${player.id}`;
        playerDiv.textContent = `${player.position}: ${player.id}`;
        playerDiv.className = 'player';

        if (player.ready) {
            playerDiv.classList.add('ready');
        }

        playerDisplayDiv.appendChild(playerDiv);
    });
}

function updateHandSize(playerId, handSize) {
    const playerDiv = document.getElementById(`player-${playerId}`);
    if (playerDiv) {
        playerDiv.textContent = playerDiv.textContent.split(' (')[0] + ` (手牌: ${handSize})`;
    }
}

// --------------------------------------------------------------------
//                        4. Event Bindings
// --------------------------------------------------------------------

playButton.addEventListener('click', () => {
    const selectedCards = getSelectedCards();
    socket.emit('play_cards', selectedCards);
});

passButton.addEventListener('click', () => {
    socket.emit('pass_turn');
});

readyButton.addEventListener('click', () => {
    socket.emit('player_ready');
});

resetButton.addEventListener('click', () => {
    socket.emit('request_reset');
});

for (let i = 1; i <= 5; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.text = i;
    roomSelect.add(option);
  }