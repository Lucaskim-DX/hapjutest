// server.js - Ultimate Performance Optimized Version
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// ========== Cluster Mode ==========
const numCPUs = os.cpus().length;
const USE_CLUSTER = process.env.USE_CLUSTER === 'true' && numCPUs > 1;

if (USE_CLUSTER && cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  console.log(`Forking ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  // Worker or single process
  startServer();
}

function startServer() {
  const app = express();
  const server = http.createServer(app);

  // WebSocket with compression (permessage-deflate)
  const wss = new WebSocket.Server({
    server,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 100
    },
    maxPayload: 64 * 1024 // 64KB max message size
  });

  // ========== Rate Limiting ==========
  const rateLimits = new Map();
  const RATE_LIMIT_WINDOW = 1000; // 1 second
  const RATE_LIMIT_MAX = 50; // 50 messages per second per IP

  function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimits.get(ip);

    if (!record || now - record.start > RATE_LIMIT_WINDOW) {
      rateLimits.set(ip, { start: now, count: 1 });
      return true;
    }

    record.count++;
    if (record.count > RATE_LIMIT_MAX) {
      return false; // Rate limited
    }
    return true;
  }

  // Clean up old rate limit entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimits) {
      if (now - record.start > RATE_LIMIT_WINDOW * 10) {
        rateLimits.delete(ip);
      }
    }
  }, 60000);

  // ========== Static File Caching ==========
  app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      // Cache JS and CSS longer
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
      }
      // Don't cache HTML
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));

  app.use(express.json({ limit: '10kb' })); // Limit JSON body size

  // ========== Memory Optimization ==========
  // Use WeakRef-like pattern for cleanup
  const connectionTimestamps = new Map();

  function trackConnection(ws, ip) {
    connectionTimestamps.set(ws, { ip, connectedAt: Date.now() });
  }

  function untrackConnection(ws) {
    connectionTimestamps.delete(ws);
  }

  // ========== 데이터 구조 ==========
  const rooms = {};
  /*
  rooms = {
    roomId: {
      host: peerId,
      settings: { maxPeers, password, waitingRoom, bpm },
      peers: { peerId: { ws, ip, nickname, role, approved, joinedAt } },
      waiting: { peerId: { ws, ip, nickname } },
      chat: [],
      metronome: { bpm, isPlaying, startTime, hostTime },
      createdAt
    }
  }
  */

  // ========== 유틸리티 ==========
  function broadcast(room, message, excludePeerId = null) {
    const msg = JSON.stringify(message);
    Object.entries(room.peers).forEach(([pid, peer]) => {
      if (pid !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(msg);
      }
    });
  }

  function broadcastToWaiting(room, message) {
    const msg = JSON.stringify(message);
    Object.values(room.waiting).forEach(peer => {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(msg);
      }
    });
  }

  function getOrCreateRoom(roomId, hostId = null) {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        host: hostId,
        settings: {
          maxPeers: 12,
          password: null,
          waitingRoom: false,
          bpm: 120
        },
        peers: {},
        waiting: {},
        chat: [],
        metronome: {
          bpm: 120,
          isPlaying: false,
          startTime: null,
          hostTime: null
        },
        createdAt: Date.now()
      };
    }
    return rooms[roomId];
  }

  function isHost(room, peerId) {
    return room.host === peerId;
  }

  // ========== Heartbeat ==========
  function heartbeat() { this.isAlive = true; }

  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // ========== WebSocket 처리 ==========
  wss.on('connection', (ws, req) => {
    let peerId = null;
    let roomId = null;
    let nickname = null;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    ws.ip = ip;
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    // Track connection
    trackConnection(ws, ip);

    ws.on('message', (data) => {
      // Rate limiting check
      if (!checkRateLimit(ip)) {
        ws.send(JSON.stringify({ type: 'error', error: 'rate-limited' }));
        return;
      }

      const message = data.toString();
      if (message === 'ping') { ws.send('pong'); return; }

      let msg;
      try { msg = JSON.parse(message); }
      catch (e) { return; }

      // ===== 방 생성/입장 =====
      if (msg.type === 'create-room') {
        roomId = msg.roomId;
        peerId = msg.peerId;
        nickname = msg.nickname || peerId.substring(0, 8);

        const room = getOrCreateRoom(roomId, peerId);
        room.host = peerId;
        room.settings = { ...room.settings, ...msg.settings };
        room.peers[peerId] = {
          ws, ip, nickname,
          role: 'host',
          approved: true,
          joinedAt: Date.now()
        };

        ws.send(JSON.stringify({
          type: 'room-created',
          roomId,
          isHost: true,
          settings: room.settings
        }));

        console.log(`[${roomId}] Room created by ${nickname}`);
      }

      if (msg.type === 'join') {
        peerId = msg.peerId;
        roomId = msg.roomId;
        nickname = msg.nickname || peerId.substring(0, 8);

        const room = rooms[roomId];

        if (!room) {
          ws.send(JSON.stringify({ type: 'error', error: 'room-not-found' }));
          return;
        }

        // 비밀번호 확인
        if (room.settings.password && room.settings.password !== msg.password) {
          ws.send(JSON.stringify({ type: 'error', error: 'wrong-password' }));
          return;
        }

        // 인원 제한
        if (Object.keys(room.peers).length >= room.settings.maxPeers) {
          ws.send(JSON.stringify({ type: 'error', error: 'room-full' }));
          return;
        }

        // 대기실 모드
        if (room.settings.waitingRoom) {
          room.waiting[peerId] = { ws, ip, nickname };
          ws.send(JSON.stringify({ type: 'waiting-room' }));

          // 호스트에게 알림
          if (room.peers[room.host]?.ws.readyState === WebSocket.OPEN) {
            room.peers[room.host].ws.send(JSON.stringify({
              type: 'waiting-request',
              peerId,
              nickname,
              ip
            }));
          }
          console.log(`[${roomId}] ${nickname} is waiting for approval`);
          return;
        }

        // 바로 입장
        addPeerToRoom(room, peerId, ws, ip, nickname);
      }

      // ===== 대기실 승인/거부 =====
      if (msg.type === 'approve-peer') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        const waitingPeer = room.waiting[msg.targetPeerId];
        if (waitingPeer) {
          delete room.waiting[msg.targetPeerId];
          addPeerToRoom(room, msg.targetPeerId, waitingPeer.ws, waitingPeer.ip, waitingPeer.nickname);
        }
      }

      if (msg.type === 'reject-peer') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        const waitingPeer = room.waiting[msg.targetPeerId];
        if (waitingPeer) {
          waitingPeer.ws.send(JSON.stringify({ type: 'rejected' }));
          delete room.waiting[msg.targetPeerId];
        }
      }

      // ===== 호스트 권한 =====
      if (msg.type === 'kick-peer') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        const targetPeer = room.peers[msg.targetPeerId];
        if (targetPeer && msg.targetPeerId !== room.host) {
          targetPeer.ws.send(JSON.stringify({ type: 'kicked' }));
          targetPeer.ws.close();
        }
      }

      if (msg.type === 'mute-peer') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        const targetPeer = room.peers[msg.targetPeerId];
        if (targetPeer) {
          targetPeer.ws.send(JSON.stringify({
            type: 'force-mute',
            muted: msg.muted
          }));
          broadcast(room, {
            type: 'peer-muted',
            peerId: msg.targetPeerId,
            muted: msg.muted
          });
        }
      }

      if (msg.type === 'update-settings') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        room.settings = { ...room.settings, ...msg.settings };
        broadcast(room, { type: 'settings-updated', settings: room.settings });
      }

      if (msg.type === 'transfer-host') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        if (room.peers[msg.targetPeerId]) {
          room.host = msg.targetPeerId;
          room.peers[peerId].role = 'peer';
          room.peers[msg.targetPeerId].role = 'host';
          broadcast(room, {
            type: 'host-changed',
            newHostId: msg.targetPeerId,
            newHostName: room.peers[msg.targetPeerId].nickname
          });
        }
      }

      // ===== 메트로놈 =====
      if (msg.type === 'metronome-start') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        room.metronome = {
          bpm: msg.bpm || room.settings.bpm,
          isPlaying: true,
          startTime: Date.now(),
          hostTime: msg.hostTime
        };

        broadcast(room, {
          type: 'metronome-sync',
          ...room.metronome
        });
      }

      if (msg.type === 'metronome-stop') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        room.metronome.isPlaying = false;
        broadcast(room, { type: 'metronome-stop' });
      }

      if (msg.type === 'metronome-bpm') {
        const room = rooms[roomId];
        if (!room || !isHost(room, peerId)) return;

        room.metronome.bpm = msg.bpm;
        room.settings.bpm = msg.bpm;
        broadcast(room, { type: 'metronome-bpm', bpm: msg.bpm });
      }

      // ===== 채팅 =====
      if (msg.type === 'chat') {
        const room = rooms[roomId];
        if (!room) return;

        const chatMessage = {
          id: Date.now(),
          peerId,
          nickname,
          message: msg.message,
          timestamp: Date.now()
        };

        room.chat.push(chatMessage);
        if (room.chat.length > 200) room.chat = room.chat.slice(-200);

        broadcast(room, { type: 'chat-message', ...chatMessage });
      }

      // ===== 시그널링 =====
      if (['offer', 'answer', 'ice-candidate', 'ice-candidates-batch'].includes(msg.type)) {
        const room = rooms[roomId];
        const targetPeer = room?.peers[msg.to];
        if (targetPeer?.ws.readyState === WebSocket.OPEN) {
          targetPeer.ws.send(JSON.stringify({ ...msg, from: peerId }));
        }
      }

      // ===== 화면 공유 알림 =====
      if (msg.type === 'screen-share-started') {
        const room = rooms[roomId];
        if (room) {
          broadcast(room, {
            type: 'screen-share-started',
            peerId,
            nickname
          }, peerId);
        }
      }

      if (msg.type === 'screen-share-stopped') {
        const room = rooms[roomId];
        if (room) {
          broadcast(room, {
            type: 'screen-share-stopped',
            peerId
          }, peerId);
        }
      }

      // ===== 오디오 라우팅 설정 =====
      if (msg.type === 'audio-routing') {
        const room = rooms[roomId];
        const targetPeer = room?.peers[msg.to];
        if (targetPeer?.ws.readyState === WebSocket.OPEN) {
          targetPeer.ws.send(JSON.stringify({
            type: 'audio-routing',
            from: peerId,
            enabled: msg.enabled
          }));
        }
      }

      // ===== 지연 측정 =====
      if (msg.type === 'latency-ping') {
        const targetPeer = rooms[roomId]?.peers[msg.to];
        if (targetPeer?.ws.readyState === WebSocket.OPEN) {
          targetPeer.ws.send(JSON.stringify({
            type: 'latency-ping',
            from: peerId,
            timestamp: msg.timestamp
          }));
        }
      }

      if (msg.type === 'latency-pong') {
        const targetPeer = rooms[roomId]?.peers[msg.to];
        if (targetPeer?.ws.readyState === WebSocket.OPEN) {
          targetPeer.ws.send(JSON.stringify({
            type: 'latency-pong',
            from: peerId,
            originalTimestamp: msg.originalTimestamp,
            serverTimestamp: Date.now()
          }));
        }
      }
    });

    ws.on('close', () => {
      // Memory cleanup
      untrackConnection(ws);

      if (!roomId || !rooms[roomId]) return;

      const room = rooms[roomId];
      const leavingPeer = room.peers[peerId];

      // 대기실에서 제거
      delete room.waiting[peerId];

      // 피어 목록에서 제거
      if (room.peers[peerId]) {
        delete room.peers[peerId];

        console.log(`[${roomId}] ${nickname || peerId} left. Remaining: ${Object.keys(room.peers).length}`);

        if (Object.keys(room.peers).length === 0) {
          delete rooms[roomId];
          console.log(`[${roomId}] Room deleted (empty)`);
        } else {
          // 호스트가 나가면 다른 사람에게 양도
          if (room.host === peerId) {
            const newHost = Object.keys(room.peers)[0];
            room.host = newHost;
            room.peers[newHost].role = 'host';
            broadcast(room, {
              type: 'host-changed',
              newHostId: newHost,
              newHostName: room.peers[newHost].nickname
            });
          }

          broadcast(room, {
            type: 'peer-left',
            peerId,
            nickname: leavingPeer?.nickname || peerId
          });
        }
      }
    });

    ws.on('error', (e) => console.error('WS Error:', e.message));
  });

  function addPeerToRoom(room, peerId, ws, ip, nickname) {
    room.peers[peerId] = {
      ws, ip, nickname,
      role: 'peer',
      approved: true,
      joinedAt: Date.now()
    };

    // 기존 피어들에게 알림
    broadcast(room, {
      type: 'peer-joined',
      peerId,
      nickname,
      ip
    }, peerId);

    // 참가자에게 정보 전송
    const peerList = Object.entries(room.peers)
      .filter(([p]) => p !== peerId)
      .map(([p, peer]) => ({
        peerId: p,
        nickname: peer.nickname,
        ip: peer.ip,
        role: peer.role
      }));

    ws.send(JSON.stringify({
      type: 'joined',
      peers: peerList,
      isHost: room.host === peerId,
      hostId: room.host,
      settings: room.settings,
      metronome: room.metronome
    }));

    // 채팅 히스토리
    ws.send(JSON.stringify({
      type: 'chat-history',
      messages: room.chat.slice(-50)
    }));

    console.log(`[${room.host ? 'Room' : 'New'}] ${nickname} (${peerId}, ${ip}) joined. Total: ${Object.keys(room.peers).length}`);
  }

  // ========== REST API ==========
  app.get('/api/rooms', (req, res) => {
    const list = Object.entries(rooms).map(([id, room]) => ({
      id,
      peerCount: Object.keys(room.peers).length,
      maxPeers: room.settings.maxPeers,
      hasPassword: !!room.settings.password,
      waitingRoom: room.settings.waitingRoom,
      createdAt: room.createdAt
    }));
    res.json(list);
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = rooms[req.params.id];
    if (!room) return res.status(404).json({ error: 'Room not found' });

    res.json({
      id: req.params.id,
      peerCount: Object.keys(room.peers).length,
      maxPeers: room.settings.maxPeers,
      hasPassword: !!room.settings.password,
      waitingRoom: room.settings.waitingRoom,
      bpm: room.metronome.bpm,
      isMetronomePlaying: room.metronome.isPlaying,
      peers: Object.entries(room.peers).map(([id, p]) => ({
        id,
        nickname: p.nickname,
        role: p.role,
        joinedAt: p.joinedAt
      })),
      waitingCount: Object.keys(room.waiting).length
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Worker ${process.pid} running on http://localhost:${PORT}`);
  });
} // End of startServer function
