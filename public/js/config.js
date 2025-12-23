// config.js - 설정 및 상수
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}`;

// ICE Servers
const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

// Audio Configuration
const audioConfig = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
    lowLatencyMode: false,
    dtx: false,
    bitrate: 64000,
    ptime: 20
};

// Room Settings
const roomSettings = {
    maxParticipants: 10,
    waitingRoomEnabled: false
};

// ICE Candidate Batching
const ICE_BATCH_DELAY = 100;
const ICE_CANDIDATE_FILTER = {
    allowTcp: true,
    allowUdp: true,
    allowRelay: true
};

// Performance Settings
const STATS_INTERVAL = 2000;
const STATS_INTERVAL_IDLE = 5000;
