// app.js - Performance Optimized with Audio Worklet Support
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}`;
let ws, peerId = `peer-${Date.now()}`, roomId, nickname, localStream;
let isHost = false, hostId = null;
const peers = {}, peerInfos = {}, statsIntervals = {}, gainNodes = {};
let audioContext, metronomeInterval, currentBeat = 0;
let mediaRecorder, recordedChunks = [], recordingStart;
let screenStream = null;
let systemAudioStream = null; // 시스템 오디오 스트림
let mixedStream = null; // 마이크 + 시스템 오디오 믹싱
let micGainNode = null; // 마이크 볼륨 조절용
let systemGainNode = null; // 시스템 오디오 볼륨 조절용
let systemAudioAnalyser = null; // 시스템 오디오 분석용
let systemMeterAnimationId = null; // 애니메이션 ID

// Audio Worklet support
let audioWorkletReady = false;
const workletNodes = {}; // Store worklet nodes for each peer

// ICE Candidate Batching
const iceBatchQueues = {}; // Queue per peer
const ICE_BATCH_DELAY = 50; // ms to wait before sending batch
const iceBatchTimers = {};

// Sync/Latency Compensation (지연 보정)
const syncConfig = {
    globalBuffer: 50,      // 글로벌 버퍼 (ms) - 모든 피어 오디오 지연
    autoBuffer: false,     // 자동 버퍼 모드 (RTT 기반)
    maxBuffer: 200         // 최대 버퍼 (ms)
};
const peerDelayNodes = {};  // { peerId: DelayNode }
const peerOffsets = {};     // { peerId: offset in ms }

// Performance Monitoring
const perfData = {
    startTime: Date.now(),
    totalBytesSent: 0,
    totalBytesRecv: 0,
    avgLatency: 0,
    avgJitter: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    peakLatency: 0,
    minLatency: Infinity,
    totalPacketsLost: 0,
    bitrateHistory: [],
    latencyHistory: []
};

// Audio Settings for Optimization
const audioConfig = {
    bitrate: 64000,
    sampleRate: 48000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    lowLatencyMode: true,
    dtx: false,        // Discontinuous Transmission (무음 시 전송 중단)
    cbr: true,         // Constant Bitrate (일정 비트레이트)
    fec: true,         // Forward Error Correction (오류 복구)
    autoBitrate: false // Adaptive Bitrate Control
};

// ICE Servers - Multiple STUN/TURN for reliability
const iceServers = [
    // Google STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },

    // Additional public STUN servers
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.voip.blackberry.com:3478' },

    // Metered TURN servers (free tier)
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },

    // Relay Metered additional endpoints
    { urls: 'turn:relay.metered.ca:80', username: 'e7b03e59a7c92d87a77d3b64', credential: 'PEvMEwBIvQHWZa0e' },
    { urls: 'turn:relay.metered.ca:443', username: 'e7b03e59a7c92d87a77d3b64', credential: 'PEvMEwBIvQHWZa0e' },
    { urls: 'turn:relay.metered.ca:443?transport=tcp', username: 'e7b03e59a7c92d87a77d3b64', credential: 'PEvMEwBIvQHWZa0e' }
];

// DOM
const $ = id => document.getElementById(id);
const roomInput = $('roomId'), nickInput = $('nickname'), micSelect = $('micSelect');
const joinBtn = $('joinBtn'), leaveBtn = $('leaveBtn'), audioBtn = $('audioBtn');
const peersEl = $('peers'), chatMsgs = $('chatMessages'), chatIn = $('chatInput');

// 보안 환경 체크 (HTTPS 또는 localhost 필요)
function isSecureContext() {
    // window.isSecureContext를 먼저 확인
    if (window.isSecureContext !== undefined) {
        return window.isSecureContext;
    }
    // 폴백: 수동으로 확인
    const protocol = location.protocol;
    const hostname = location.hostname;
    return protocol === 'https:' ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1';
}

function showSecurityWarning() {
    const warning = document.createElement('div');
    warning.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.95);
        color: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: 'Pretendard', sans-serif;
        padding: 20px;
        text-align: center;
    `;
    warning.innerHTML = `
        <h1 style="color: #ff416c; margin-bottom: 20px;">🔒 HTTPS 필요</h1>
        <p style="font-size: 18px; margin-bottom: 15px;">
            WebRTC와 미디어 기능은 <strong>보안 연결</strong>이 필요합니다.
        </p>
        <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
            <p style="margin-bottom: 10px;"><strong>현재 접속:</strong> ${location.href}</p>
            <p style="color: #ff6b6b;">❌ 비보안 연결 (HTTP)</p>
        </div>
        <div style="text-align: left; margin: 20px 0;">
            <p style="font-size: 16px; margin-bottom: 10px;"><strong>✅ 해결 방법:</strong></p>
            <ol style="margin-left: 20px; line-height: 2;">
                <li>로컬에서 테스트: <code style="background:#333;padding:2px 6px;border-radius:4px;">http://localhost:3000</code></li>
                <li>HTTPS로 배포 (Render, Vercel 등)</li>
                <li>ngrok 사용: <code style="background:#333;padding:2px 6px;border-radius:4px;">ngrok http 3000</code></li>
            </ol>
        </div>
        <button onclick="location.href='http://localhost:3000'" 
                style="background: linear-gradient(135deg, #6366f1, #22d3ee); 
                       color: white; padding: 12px 30px; border: none; 
                       border-radius: 8px; font-size: 16px; cursor: pointer;
                       margin-top: 20px;">
            localhost로 이동
        </button>
    `;
    document.body.appendChild(warning);
    console.error('보안 연결 필요: HTTPS 또는 localhost에서 접속해주세요.');
}

// Init
async function init() {
    // 보안 환경 체크 (HTTPS 또는 localhost 필요)
    if (!isSecureContext()) {
        showSecurityWarning();
        return;
    }

    await loadMics();
    nickInput.value = `User${Math.floor(Math.random() * 1000)}`;
    $('masterVol').oninput = e => { $('masterVolVal').textContent = e.target.value + '%'; setMasterVol(e.target.value / 100); };

    // Start performance monitoring (optimized intervals)
    setInterval(updatePerfMonitor, 1000);
    setInterval(updateMemoryUsage, 10000); // Less frequent memory checks

    // Initialize Audio Worklet
    await initAudioWorklet();

    // Sync UI with current settings
    syncSettingsUI();
}

// Initialize Audio Worklet
async function initAudioWorklet() {
    try {
        // AudioContext가 없거나 audioWorklet을 지원하지 않으면 스킵
        if (typeof AudioContext === 'undefined') {
            console.warn('AudioContext not supported');
            audioWorkletReady = false;
            return;
        }

        audioContext = new AudioContext({ latencyHint: 'interactive' });

        // audioWorklet 지원 여부 확인
        if (!audioContext.audioWorklet) {
            console.warn('Audio Worklet not supported in this browser/context');
            audioWorkletReady = false;
            return;
        }

        await audioContext.audioWorklet.addModule('audio-worklet-processor.js');
        audioWorkletReady = true;
        console.log('Audio Worklet initialized successfully');
    } catch (e) {
        console.warn('Audio Worklet not supported, falling back to ScriptProcessor:', e);
        audioWorkletReady = false;
    }
}

// Sync toggle UI with audioConfig
function syncSettingsUI() {
    const toggles = {
        'toggleEcho': audioConfig.echoCancellation,
        'toggleNoise': audioConfig.noiseSuppression,
        'toggleAGC': audioConfig.autoGainControl,
        'toggleDTX': audioConfig.dtx,
        'toggleCBR': audioConfig.cbr,
        'toggleFEC': audioConfig.fec,
        'lowLatencyToggle': audioConfig.lowLatencyMode
    };

    for (const [id, value] of Object.entries(toggles)) {
        const el = $(id);
        if (el) {
            el.classList.toggle('on', value);
        }
    }

    // Sync bitrate select
    const bitrateEl = $('bitrateSelect');
    if (bitrateEl) {
        bitrateEl.value = audioConfig.autoBitrate ? '0' : audioConfig.bitrate.toString();
    }
}

// Toggle audio setting
function toggleAudioSetting(setting) {
    const toggleMap = {
        'echo': { config: 'echoCancellation', el: 'toggleEcho' },
        'noise': { config: 'noiseSuppression', el: 'toggleNoise' },
        'agc': { config: 'autoGainControl', el: 'toggleAGC' },
        'dtx': { config: 'dtx', el: 'toggleDTX' },
        'cbr': { config: 'cbr', el: 'toggleCBR' },
        'fec': { config: 'fec', el: 'toggleFEC' },
        'lowLatency': { config: 'lowLatencyMode', el: 'lowLatencyToggle' }
    };

    const map = toggleMap[setting];
    if (!map) return;

    audioConfig[map.config] = !audioConfig[map.config];
    const el = $(map.el);
    if (el) el.classList.toggle('on', audioConfig[map.config]);

    // Show feedback
    const labels = {
        'echo': '에코 캔슬링',
        'noise': '노이즈 제거',
        'agc': '자동 게인',
        'dtx': 'DTX',
        'cbr': 'CBR',
        'fec': 'FEC',
        'lowLatency': '저지연 모드'
    };
    showToast(`${labels[setting]}: ${audioConfig[map.config] ? 'ON' : 'OFF'}`, 'info');

    // Settings that need reconnection
    const needsReconnect = ['dtx', 'cbr', 'fec'];
    if (needsReconnect.includes(setting)) {
        showToast('재연결 시 적용됩니다', 'info');
    }

    // Settings that can apply immediately (mic settings)
    const micSettings = ['echo', 'noise', 'agc', 'lowLatency'];
    if (micSettings.includes(setting) && localStream) {
        // Re-acquire local stream with new settings
        reapplyMicSettings();
    }
}

// Change bitrate
function changeBitrate(value) {
    const val = parseInt(value);
    if (val === 0) {
        audioConfig.autoBitrate = true;
        showToast('적응형 비트레이트 (ABR) 활성화', 'info');
    } else {
        audioConfig.autoBitrate = false;
        audioConfig.bitrate = val;
        showToast(`비트레이트: ${val / 1000} kbps`, 'info');

        // Apply to existing connections
        Object.values(peers).forEach(pc => adjustBitrate(pc, val));
    }
}

// Reapply mic settings (for echo, noise, agc changes)
async function reapplyMicSettings() {
    if (!localStream) return;

    try {
        // Stop old stream
        localStream.getTracks().forEach(t => t.stop());

        // Get new stream with updated settings
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: micSelect.value ? { exact: micSelect.value } : undefined,
                echoCancellation: audioConfig.echoCancellation,
                noiseSuppression: audioConfig.noiseSuppression,
                autoGainControl: audioConfig.autoGainControl,
                sampleRate: audioConfig.sampleRate,
                channelCount: 1,
                latency: audioConfig.lowLatencyMode ? 0.01 : 0.1
            }
        });

        // Replace tracks in all peer connections
        const audioTrack = localStream.getAudioTracks()[0];
        Object.values(peers).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender) sender.replaceTrack(audioTrack);
        });

        // Restart local meter
        startLocalMeter();

        showToast('마이크 설정 적용됨', 'success');
    } catch (e) {
        console.error('Failed to reapply mic settings:', e);
        showToast('설정 적용 실패', 'error');
    }
}

async function loadMics() {
    try {
        // mediaDevices API 지원 여부 확인 (보안 컨텍스트 필요)
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn('mediaDevices API not available - requires HTTPS or localhost');
            if (micSelect) {
                micSelect.innerHTML = '<option value="">마이크 사용 불가 (HTTPS 필요)</option>';
            }
            return;
        }

        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devs = await navigator.mediaDevices.enumerateDevices();
        micSelect.innerHTML = devs.filter(d => d.kind === 'audioinput').map((d, i) => `<option value="${d.deviceId}">${d.label || 'Mic ' + (i + 1)}</option>`).join('');
    } catch (e) { console.error('Failed to load microphones:', e); }
}

// SDP Optimization for Opus Codec
function optimizeSdp(sdp) {
    let optimized = sdp;

    // Build Opus parameters from audioConfig
    const dtx = audioConfig.dtx ? 1 : 0;
    const cbr = audioConfig.cbr ? 1 : 0;
    const fec = audioConfig.fec ? 1 : 0;
    const bitrate = audioConfig.bitrate;

    // Apply Opus codec parameters
    optimized = optimized.replace(
        /(a=fmtp:111 .*)/g,
        `$1;maxaveragebitrate=${bitrate};stereo=0;cbr=${cbr};useinbandfec=${fec};usedtx=${dtx};ptime=20`
    );

    // Prioritize Opus codec
    const lines = optimized.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=audio')) {
            lines[i] = lines[i].replace(/(\d+)/g, (m, p1, offset) => {
                if (offset > 8 && p1 === '111') return '';
                return p1;
            }).replace('m=audio 9 UDP/TLS/RTP/SAVPF', 'm=audio 9 UDP/TLS/RTP/SAVPF 111');
        }
    }

    return optimized;
}

// Adaptive Bitrate based on network conditions
function getAdaptiveBitrate(latency, lossRate) {
    if (lossRate > 5 || latency > 300) return 32000;  // Low quality
    if (lossRate > 2 || latency > 150) return 48000;  // Medium
    return 64000;  // High quality
}

async function adjustBitrate(pc, targetBitrate) {
    const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
    if (!sender) return;

    try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = targetBitrate;
        await sender.setParameters(params);

        // Update monitoring
        if ($('currentBitrate')) {
            $('currentBitrate').textContent = (targetBitrate / 1000) + ' kbps';
        }
    } catch (e) {
        console.warn('Bitrate adjustment failed:', e);
    }
}

// Room Management
async function createRoom() {
    roomId = roomInput.value || 'room-' + Date.now();
    nickname = nickInput.value || 'Host';
    await getLocalStream();
    connectWS('create-room', { settings: getRoomSettings() });
}

async function joinRoom() {
    roomId = roomInput.value;
    nickname = nickInput.value || 'Guest';
    const pwd = $('roomPwd')?.value;
    if (!roomId) return showToast('Enter room ID', 'error');
    await getLocalStream();
    connectWS('join', { password: pwd });
}

function getRoomSettings() {
    return {
        maxPeers: parseInt($('maxPeers')?.value) || 12,
        password: $('roomPwdSet')?.value || null,
        waitingRoom: $('waitingRoom')?.classList.contains('on') || false,
        bpm: parseInt($('bpmInput')?.value) || 120
    };
}

async function getLocalStream() {
    // mediaDevices API 지원 여부 확인 (보안 컨텍스트 필요)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('마이크 사용 불가: HTTPS 또는 localhost에서 접속해주세요', 'error');
        throw new Error('mediaDevices API not available - requires HTTPS or localhost');
    }

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: micSelect.value ? { exact: micSelect.value } : undefined,
            echoCancellation: audioConfig.echoCancellation,
            noiseSuppression: audioConfig.noiseSuppression,
            autoGainControl: audioConfig.autoGainControl,
            sampleRate: audioConfig.sampleRate,
            channelCount: 1,
            latency: audioConfig.lowLatencyMode ? 0.01 : 0.1
        }
    });

    // 시스템 오디오가 활성화되어 있으면 믹싱
    if (systemAudioStream) {
        await mixAudioStreams();
    }

    startLocalMeter();
    audioBtn.disabled = false;
    $('recordBtn').disabled = false;
}

function connectWS(type, extra = {}) {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
        ws.send(JSON.stringify({ type, peerId, roomId, nickname, ...extra }));
        updateStatus('Connected');
        joinBtn.disabled = true;
        leaveBtn.disabled = false;
        perfData.startTime = Date.now();
    };
    ws.onmessage = e => {
        if (e.data === 'pong') return;
        handleMsg(JSON.parse(e.data));
    };
    ws.onclose = () => { updateStatus('Disconnected'); resetUI(); };
    ws.onerror = () => updateStatus('Connection error');

    // Heartbeat
    setInterval(() => { if (ws?.readyState === 1) ws.send('ping'); }, 25000);
}

function handleMsg(msg) {
    switch (msg.type) {
        case 'room-created':
        case 'joined':
            isHost = msg.isHost;
            hostId = msg.hostId || peerId;
            $('hostControls').style.display = isHost ? 'block' : 'none';
            if (msg.settings) applySettings(msg.settings);
            if (msg.metronome?.isPlaying) syncMetronome(msg.metronome);
            msg.peers?.forEach(p => { peerInfos[p.peerId] = p; createPC(p.peerId, true); });
            updateCount();
            break;
        case 'peer-joined':
            peerInfos[msg.peerId] = msg;
            createPC(msg.peerId, false);
            updateCount();
            addSysMsg(`${msg.nickname} joined`);
            break;
        case 'peer-left':
            closePC(msg.peerId);
            updateCount();
            addSysMsg(`${msg.nickname} left`);
            break;
        case 'offer': handleOffer(msg.from, msg.sdp); break;
        case 'answer': handleAnswer(msg.from, msg.sdp); break;
        case 'ice-candidate': handleIce(msg.from, msg.candidate); break;
        case 'ice-candidates-batch':
            msg.candidates?.forEach(c => handleIce(msg.from, c));
            break;
        case 'chat-message': addChatMsg(msg); break;
        case 'chat-history': msg.messages?.forEach(m => addChatMsg(m, true)); break;
        case 'waiting-room': updateStatus('Waiting for approval...'); break;
        case 'waiting-request': addWaitingPeer(msg); break;
        case 'rejected': showToast('Entry denied', 'error'); ws.close(); break;
        case 'kicked': showToast('You were kicked', 'error'); ws.close(); break;
        case 'force-mute': forceMute(msg.muted); break;
        case 'host-changed':
            hostId = msg.newHostId;
            isHost = hostId === peerId;
            $('hostControls').style.display = isHost ? 'block' : 'none';
            addSysMsg(`${msg.newHostName} is now host`);
            break;
        case 'metronome-sync': syncMetronome(msg); break;
        case 'metronome-stop': stopMetronomeLocal(); break;
        case 'metronome-bpm': $('bpmDisplay').textContent = msg.bpm; break;
        case 'settings-updated': applySettings(msg.settings); break;
        case 'error': showToast(msg.error, 'error'); break;
    }
}

// WebRTC with Optimizations
async function createPC(rid, init) {
    const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    });
    peers[rid] = pc;

    // 오디오 트랙 추가 (마이크 또는 믹싱된 오디오)
    if (mixedStream) {
        // 시스템 오디오와 믹싱된 스트림 사용
        mixedStream.getTracks().forEach(t => pc.addTrack(t, mixedStream));
    } else if (localStream) {
        // 일반 마이크 스트림 사용
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }


    // 화면 공유 트랙 추가 (있는 경우) - 오디오 우선 설정
    if (screenStream) {
        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = pc.addTrack(videoTrack, screenStream);

        // 비디오 인코딩 파라미터 설정 (오디오 우선)
        setTimeout(async () => {
            try {
                const params = sender.getParameters();
                if (!params.encodings) {
                    params.encodings = [{}];
                }

                params.encodings[0].maxBitrate = 500000;  // 500 Kbps
                params.encodings[0].priority = 'low';
                params.encodings[0].networkPriority = 'low';

                await sender.setParameters(params);
                console.log(`Video encoding optimized for peer ${rid}`);
            } catch (e) {
                console.warn('Failed to set video parameters:', e);
            }
        }, 100);  // 연결 설정 후 적용
    }

    pc.ontrack = e => {
        const track = e.track;
        const stream = e.streams[0];

        if (track.kind === 'audio') {
            // 오디오 트랙 처리
            setupRemoteAudio(rid, stream);
        } else if (track.kind === 'video') {
            // 비디오 트랙 처리 (화면 공유)
            setupRemoteVideo(rid, stream);
        }
    };

    // ICE Candidate with batching and filtering
    pc.onicecandidate = e => {
        if (!e.candidate) {
            // ICE gathering complete, flush remaining candidates
            flushIceCandidates(rid);
            return;
        }

        // Filter out unwanted candidates
        if (shouldFilterCandidate(e.candidate)) {
            console.log('Filtered ICE candidate:', e.candidate.candidate);
            return;
        }

        // Add to batch queue
        queueIceCandidate(rid, e.candidate);
    };

    pc.onconnectionstatechange = () => updatePeerUI(rid);

    // ICE Restart on failure
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
            console.log('ICE failed, restarting...');
            pc.restartIce();
        } else if (pc.iceConnectionState === 'disconnected') {
            setTimeout(() => {
                if (pc.iceConnectionState === 'disconnected') pc.restartIce();
            }, 3000);
        }
    };

    startStats(rid, pc);
    updatePeerUI(rid);

    if (init) {
        const offer = await pc.createOffer();
        // Apply SDP optimization
        const optimizedSdp = optimizeSdp(offer.sdp);
        await pc.setLocalDescription({ type: 'offer', sdp: optimizedSdp });
        wsSend('offer', { to: rid, sdp: optimizedSdp });
    }
}

async function handleOffer(from, sdp) {
    if (!peers[from]) await createPC(from, false);
    const pc = peers[from];
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    const optimizedSdp = optimizeSdp(answer.sdp);
    await pc.setLocalDescription({ type: 'answer', sdp: optimizedSdp });
    wsSend('answer', { to: from, sdp: optimizedSdp });
}

async function handleAnswer(from, sdp) {
    const pc = peers[from];
    if (pc?.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp });
    }
}

async function handleIce(from, cand) {
    const pc = peers[from];
    if (pc?.remoteDescription) {
        await pc.addIceCandidate(cand).catch(() => { });
    }
}

function closePC(rid) {
    peers[rid]?.close();
    delete peers[rid];
    delete peerInfos[rid];
    clearInterval(statsIntervals[rid]);
    clearTimeout(iceBatchTimers[rid]);
    delete statsIntervals[rid];
    delete iceBatchQueues[rid];
    delete iceBatchTimers[rid];
    delete gainNodes[rid];
    delete workletNodes[rid];
    // Sync cleanup
    delete peerDelayNodes[rid];
    delete peerOffsets[rid];
    $(`audio-${rid}`)?.remove();
    $(`peer-${rid}`)?.remove();
}

function wsSend(type, data = {}) {
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
}

// ICE Candidate Filtering
function shouldFilterCandidate(candidate) {
    const candidateStr = candidate.candidate || '';

    // Filter TCP candidates when UDP is preferred for lower latency
    // TCP is slower but more reliable, only use as fallback
    if (candidateStr.includes(' tcp ')) {
        // Keep TCP relay as last resort
        if (!candidateStr.includes('typ relay')) {
            return true; // Filter out non-relay TCP
        }
    }

    // Filter IPv6 link-local addresses (often cause issues)
    if (candidateStr.includes(' fe80:')) {
        return true;
    }

    // Filter mDNS candidates in some cases (privacy feature, can cause delays)
    // Uncomment if needed:
    // if (candidateStr.includes('.local')) return true;

    return false;
}

// ICE Candidate Batching
function queueIceCandidate(rid, candidate) {
    if (!iceBatchQueues[rid]) {
        iceBatchQueues[rid] = [];
    }

    iceBatchQueues[rid].push(candidate);

    // Reset timer
    clearTimeout(iceBatchTimers[rid]);

    // Send batch after delay (allows multiple candidates to accumulate)
    iceBatchTimers[rid] = setTimeout(() => {
        flushIceCandidates(rid);
    }, ICE_BATCH_DELAY);
}

function flushIceCandidates(rid) {
    const queue = iceBatchQueues[rid];
    if (!queue || queue.length === 0) return;

    // Send all candidates in one message
    if (queue.length === 1) {
        // Single candidate, send normally
        wsSend('ice-candidate', { to: rid, candidate: queue[0] });
    } else {
        // Multiple candidates, send as batch
        wsSend('ice-candidates-batch', { to: rid, candidates: queue });
    }

    console.log(`Sent ${queue.length} ICE candidates to ${rid}`);

    // Clear queue
    iceBatchQueues[rid] = [];
    clearTimeout(iceBatchTimers[rid]);
}

// Remote Video (Screen Share)
function setupRemoteVideo(rid, stream) {
    let videoContainer = $(`video-container-${rid}`);

    if (!videoContainer) {
        // 비디오 컨테이너 생성
        videoContainer = document.createElement('div');
        videoContainer.id = `video-container-${rid}`;
        videoContainer.className = 'remote-video-container';
        videoContainer.style.cssText = 'margin-top:10px;background:#000;border-radius:8px;overflow:hidden;';

        const video = document.createElement('video');
        video.id = `video-${rid}`;
        video.autoplay = true;
        video.style.cssText = 'width:100%;max-height:200px;object-fit:contain;';
        video.srcObject = stream;

        videoContainer.appendChild(video);

        // 피어 카드에 추가
        const peerCard = $(`peer-${rid}`);
        if (peerCard) {
            peerCard.appendChild(videoContainer);
        }
    } else {
        // 기존 비디오 업데이트
        const video = $(`video-${rid}`);
        if (video) {
            video.srcObject = stream;
        }
    }

    console.log(`Remote video setup for peer ${rid}`);
}

// Audio with Audio Worklet (low latency) or fallback to Web Audio API
function setupRemoteAudio(rid, stream) {
    let audio = $(`audio-${rid}`);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${rid}`;
        audio.autoplay = true;
        document.body.appendChild(audio);
    }
    audio.srcObject = stream;

    if (!audioContext) audioContext = new AudioContext({ latencyHint: 'interactive' });

    const src = audioContext.createMediaStreamSource(stream);

    if (audioWorkletReady) {
        // Use Audio Worklet for low latency
        setupAudioWorkletPipeline(rid, src);
    } else {
        // Fallback to standard Web Audio API
        setupStandardAudioPipeline(rid, src);
    }

    audio.muted = true;
}

// Audio Worklet pipeline (low latency) with Delay for sync
async function setupAudioWorkletPipeline(rid, src) {
    try {
        // Delay node for latency compensation (지연 보정)
        const delayNode = audioContext.createDelay(0.5); // 최대 500ms
        const bufferMs = syncConfig.globalBuffer + (peerOffsets[rid] || 0);
        delayNode.delayTime.value = Math.max(0, bufferMs) / 1000;
        peerDelayNodes[rid] = delayNode;

        // Volume meter worklet
        const meterNode = new AudioWorkletNode(audioContext, 'volume-meter-processor');
        meterNode.port.onmessage = (event) => {
            if (event.data.type === 'volume') {
                const bar = $(`vol-${rid}`);
                if (bar) bar.style.width = Math.min(100, event.data.volume) + '%';
            }
        };

        // Smooth gain worklet
        const gainNode = new AudioWorkletNode(audioContext, 'smooth-gain-processor');

        // Connect: source -> delay -> meter -> gain -> destination
        src.connect(delayNode);
        delayNode.connect(meterNode);
        delayNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Store for volume control
        workletNodes[rid] = { meter: meterNode, gain: gainNode, delay: delayNode };
        gainNodes[rid] = {
            gain: { value: 1 },
            setGain: (v) => gainNode.port.postMessage({ type: 'setGain', gain: v })
        };

        console.log(`Audio Worklet pipeline with ${bufferMs}ms delay set up for peer ${rid}`);
    } catch (e) {
        console.warn('Audio Worklet failed, falling back:', e);
        setupStandardAudioPipeline(rid, src);
    }
}

// Standard Web Audio API pipeline (fallback) with Delay for sync
function setupStandardAudioPipeline(rid, src) {
    // Delay node for latency compensation (지연 보정)
    const delayNode = audioContext.createDelay(0.5); // 최대 500ms
    const bufferMs = syncConfig.globalBuffer + (peerOffsets[rid] || 0);
    delayNode.delayTime.value = Math.max(0, bufferMs) / 1000;
    peerDelayNodes[rid] = delayNode;

    const gain = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;

    // Connect: source -> delay -> analyser/gain -> destination
    src.connect(delayNode);
    delayNode.connect(analyser);
    delayNode.connect(gain);
    gain.connect(audioContext.destination);
    gainNodes[rid] = gain;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let animationId;

    function meter() {
        if (!gainNodes[rid]) {
            cancelAnimationFrame(animationId);
            return;
        }
        analyser.getByteFrequencyData(data);
        const vol = Math.min(100, (data.reduce((a, b) => a + b) / data.length / 128) * 100);
        const bar = $(`vol-${rid}`);
        if (bar) bar.style.width = vol + '%';
        animationId = requestAnimationFrame(meter);
    }
    meter();
    console.log(`Standard audio pipeline with ${bufferMs}ms delay set up for peer ${rid}`);
}

// Local meter with Audio Worklet support
async function startLocalMeter() {
    if (!localStream) return;

    if (!audioContext) audioContext = new AudioContext({ latencyHint: 'interactive' });
    const src = audioContext.createMediaStreamSource(localStream);

    if (audioWorkletReady) {
        try {
            const meterNode = new AudioWorkletNode(audioContext, 'volume-meter-processor');
            meterNode.port.onmessage = (event) => {
                if (event.data.type === 'volume') {
                    $('localVolBar').style.width = Math.min(100, event.data.volume) + '%';
                }
            };
            src.connect(meterNode);
            console.log('Local meter using Audio Worklet');
        } catch (e) {
            console.warn('Local meter worklet failed, using fallback');
            startLocalMeterFallback(src);
        }
    } else {
        startLocalMeterFallback(src);
    }
}

function startLocalMeterFallback(src) {
    const an = audioContext.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);

    function meter() {
        an.getByteFrequencyData(data);
        const vol = Math.min(100, (data.reduce((a, b) => a + b) / data.length / 128) * 100);
        $('localVolBar').style.width = vol + '%';
        requestAnimationFrame(meter);
    }
    meter();
}

function setMasterVol(v) {
    Object.entries(gainNodes).forEach(([rid, g]) => {
        if (g.setGain) {
            // Audio Worklet node
            g.setGain(v);
            g.gain.value = v;
        } else {
            // Standard GainNode
            g.gain.value = v;
        }
    });
}

function setPeerVol(rid, v) {
    if (!gainNodes[rid]) return;
    const g = gainNodes[rid];
    if (g.setGain) {
        g.setGain(v);
        g.gain.value = v;
    } else {
        g.gain.value = v;
    }
}

function toggleAudio() {
    const t = localStream?.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; audioBtn.textContent = t.enabled ? '🎤 Mute' : '🔇 Unmute'; }
}

function forceMute(m) {
    const t = localStream?.getAudioTracks()[0];
    if (t) {
        t.enabled = !m;
        audioBtn.textContent = t.enabled ? '🎤 Mute' : '🔇 Unmute';
        showToast(m ? 'Muted by host' : 'Unmuted', 'info');
    }
}

// Performance Monitoring with optimized polling
function startStats(rid, pc) {
    let prevSent = 0, prevRecv = 0, prevTime = Date.now();
    let pollInterval = 1000; // Start with 1 second
    let consecutiveStable = 0;

    function getPollingInterval() {
        // Reduce polling frequency for stable connections and many peers
        const peerCount = Object.keys(peers).length;
        if (peerCount > 6) return 2000;  // Many peers: poll less
        if (consecutiveStable > 10) return 1500; // Stable: poll less
        return 1000; // Default
    }

    async function collectStats() {
        if (pc.connectionState === 'closed') {
            clearInterval(statsIntervals[rid]);
            return;
        }

        // Skip if tab is not visible (save CPU)
        if (document.hidden) {
            scheduleNext();
            return;
        }

        const stats = await pc.getStats();
        let lat = 0, jit = 0, sent = 0, recv = 0, loss = 0, type = '-', codec = '-';
        let currentSent = 0, currentRecv = 0;

        stats.forEach(r => {
            if (r.type === 'inbound-rtp' && r.kind === 'audio') {
                jit = r.jitter ? r.jitter * 1000 : 0;
                currentRecv = r.bytesReceived || 0;
                loss = r.packetsLost || 0;
            }
            if (r.type === 'outbound-rtp' && r.kind === 'audio') {
                currentSent = r.bytesSent || 0;
            }
            if (r.type === 'candidate-pair' && r.state === 'succeeded') {
                lat = r.currentRoundTripTime ? r.currentRoundTripTime * 1000 : 0;
            }
            if (r.type === 'local-candidate') {
                type = r.candidateType || '-';
            }
            if (r.type === 'codec' && r.mimeType?.includes('opus')) {
                codec = 'Opus';
            }
        });

        // Calculate bitrate
        const now = Date.now();
        const elapsed = (now - prevTime) / 1000;
        const sendBitrate = elapsed > 0 ? ((currentSent - prevSent) * 8 / 1000 / elapsed) : 0;
        const recvBitrate = elapsed > 0 ? ((currentRecv - prevRecv) * 8 / 1000 / elapsed) : 0;
        prevSent = currentSent;
        prevRecv = currentRecv;
        prevTime = now;

        // Track stability
        if (lat < 100 && loss === 0) {
            consecutiveStable++;
        } else {
            consecutiveStable = 0;
        }

        // Update global stats (only once per collection, not per peer)
        perfData.avgLatency = lat > 0 ? (perfData.avgLatency * 0.9 + lat * 0.1) : perfData.avgLatency;
        perfData.avgJitter = jit > 0 ? (perfData.avgJitter * 0.9 + jit * 0.1) : perfData.avgJitter;
        perfData.peakLatency = Math.max(perfData.peakLatency, lat);
        if (lat > 0) perfData.minLatency = Math.min(perfData.minLatency, lat);

        // Keep history (last 60 samples)
        perfData.latencyHistory.push(lat);
        perfData.bitrateHistory.push(sendBitrate + recvBitrate);
        if (perfData.latencyHistory.length > 60) perfData.latencyHistory.shift();
        if (perfData.bitrateHistory.length > 60) perfData.bitrateHistory.shift();

        // Adaptive bitrate (only if auto mode enabled)
        if (audioConfig.autoBitrate) {
            const lossRate = loss > 0 ? (loss / (loss + 100)) * 100 : 0;
            const targetBitrate = getAdaptiveBitrate(lat, lossRate);
            if (targetBitrate !== audioConfig.bitrate) {
                audioConfig.bitrate = targetBitrate;
                adjustBitrate(pc, targetBitrate);
                const sel = $('bitrateSelect');
                if (sel) sel.value = '0';
            }
        }

        // Update UI
        updatePeerStats(rid, {
            lat: lat.toFixed(0),
            jit: jit.toFixed(1),
            sent: (currentSent / 1024).toFixed(1),
            recv: (currentRecv / 1024).toFixed(1),
            loss,
            type,
            codec,
            sendBitrate: sendBitrate.toFixed(1),
            recvBitrate: recvBitrate.toFixed(1),
            state: pc.connectionState
        });

        scheduleNext();
    }

    function scheduleNext() {
        pollInterval = getPollingInterval();
        statsIntervals[rid] = setTimeout(collectStats, pollInterval);
    }

    collectStats();
}

function updatePerfMonitor() {
    const uptime = Math.floor((Date.now() - perfData.startTime) / 1000);
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;

    if ($('monUptime')) $('monUptime').textContent = `${mins}m ${secs}s`;
    if ($('monPeers')) $('monPeers').textContent = Object.keys(peers).length;
    if ($('monAvgLat')) $('monAvgLat').textContent = perfData.avgLatency.toFixed(1) + ' ms';
    if ($('monPeakLat')) $('monPeakLat').textContent = perfData.peakLatency.toFixed(0) + ' ms';
    if ($('monMinLat')) $('monMinLat').textContent = perfData.minLatency === Infinity ? '-' : perfData.minLatency.toFixed(0) + ' ms';
    if ($('monJitter')) $('monJitter').textContent = perfData.avgJitter.toFixed(1) + ' ms';
    if ($('monLoss')) $('monLoss').textContent = perfData.totalPacketsLost;
    if ($('monBitrate')) $('monBitrate').textContent = (audioConfig.bitrate / 1000) + ' kbps';

    // Draw mini graphs
    drawMiniGraph('latencyGraph', perfData.latencyHistory, '#00d2ff');
    drawMiniGraph('bitrateGraph', perfData.bitrateHistory, '#00ff88');
}

function drawMiniGraph(canvasId, data, color) {
    const canvas = $(canvasId);
    if (!canvas || !data.length) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    data.forEach((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - (v / max) * h * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();
}

function updateMemoryUsage() {
    if (performance.memory) {
        const used = performance.memory.usedJSHeapSize / 1048576;
        const total = performance.memory.totalJSHeapSize / 1048576;
        if ($('monMemory')) $('monMemory').textContent = `${used.toFixed(1)} / ${total.toFixed(0)} MB`;
    }
}

// Metronome
function startMetronome() {
    if (!isHost) return;
    const bpm = parseInt($('bpmInput').value) || 120;
    wsSend('metronome-start', { bpm, hostTime: Date.now() });
    syncMetronome({ bpm, isPlaying: true, startTime: Date.now() });
}

function stopMetronome() {
    if (!isHost) return;
    wsSend('metronome-stop');
    stopMetronomeLocal();
}

function syncMetronome(m) {
    if (!m.isPlaying) return;
    $('bpmDisplay').textContent = m.bpm;
    stopMetronomeLocal();
    const interval = 60000 / m.bpm;
    const dots = document.querySelectorAll('.beat-dot');
    currentBeat = 0;
    metronomeInterval = setInterval(() => {
        dots.forEach((d, i) => d.classList.toggle('active', i === currentBeat));
        playClick(currentBeat === 0);
        currentBeat = (currentBeat + 1) % 4;
    }, interval);
}

function stopMetronomeLocal() {
    clearInterval(metronomeInterval);
    document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active'));
}

function playClick(accent) {
    const ctx = audioContext || new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = accent ? 1000 : 800;
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    osc.stop(ctx.currentTime + 0.05);
}

function changeBpm(d) {
    const inp = $('bpmInput');
    inp.value = Math.max(40, Math.min(240, parseInt(inp.value) + d));
    if (isHost && metronomeInterval) wsSend('metronome-bpm', { bpm: parseInt(inp.value) });
}

// Recording
function toggleRec() {
    if (mediaRecorder?.state === 'recording') stopRec();
    else startRec();
}

function startRec() {
    recordedChunks = [];
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    if (localStream) ctx.createMediaStreamSource(localStream).connect(dest);
    Object.keys(peers).forEach(rid => {
        const audio = $(`audio-${rid}`);
        if (audio?.srcObject) ctx.createMediaStreamSource(audio.srcObject).connect(dest);
    });
    mediaRecorder = new MediaRecorder(dest.stream);
    mediaRecorder.ondataavailable = e => e.data.size && recordedChunks.push(e.data);
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `rec-${Date.now()}.webm`;
        a.click();
    };
    mediaRecorder.start(1000);
    recordingStart = Date.now();
    $('recBadge').classList.add('active');
    $('recordBtn').textContent = '⏹️ Stop';
    updateRecTime();
}

function stopRec() {
    mediaRecorder?.stop();
    $('recBadge').classList.remove('active');
    $('recordBtn').textContent = '⏺️ Record';
}

function updateRecTime() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    const s = Math.floor((Date.now() - recordingStart) / 1000);
    $('recTime').textContent = `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    setTimeout(updateRecTime, 1000);
}

// Screen Share
async function toggleScreen() {
    if (screenStream) { stopScreen(); return; }

    // 시스템 오디오가 이미 활성화되어 있는지 확인
    if (systemAudioStream) {
        showToast('시스템 오디오를 먼저 중지해주세요', 'error');
        return;
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 15, max: 30 }  // 낮은 프레임레이트로 대역폭 절약
            },
            audio: false  // 화면 공유는 비디오만 (오디오는 시스템 오디오 공유 사용)
        });
        $('screenVideo').srcObject = screenStream;
        $('screenContainer').style.display = 'block';
        $('screenBtn').textContent = '🖥️ Stop';
        $('screenBtn').classList.add('active');
        wsSend('screen-share-started');

        // 기존 연결에 비디오 트랙 추가 (낮은 우선순위 및 비트레이트 제한)
        const videoTrack = screenStream.getVideoTracks()[0];
        Object.values(peers).forEach(async pc => {
            const sender = pc.addTrack(videoTrack, screenStream);

            // 비디오 인코딩 파라미터 설정 (오디오 우선)
            const params = sender.getParameters();
            if (!params.encodings) {
                params.encodings = [{}];
            }

            // 비트레이트 제한 (500 Kbps 최대)
            params.encodings[0].maxBitrate = 500000;  // 500 Kbps
            params.encodings[0].priority = 'low';     // 낮은 우선순위
            params.encodings[0].networkPriority = 'low';

            try {
                await sender.setParameters(params);
                console.log('Video encoding optimized for audio priority');
            } catch (e) {
                console.warn('Failed to set video parameters:', e);
            }
        });

        screenStream.getVideoTracks()[0].onended = stopScreen;
        console.log('Screen sharing started with audio-priority optimization');
    } catch (e) {
        console.error('Screen share failed:', e);
        if (e.name === 'NotAllowedError') {
            showToast('화면 공유가 거부되었습니다', 'error');
        }
    }
}

function stopScreen() {
    screenStream?.getTracks().forEach(t => t.stop());

    // 기존 연결에서 비디오 트랙 제거
    if (screenStream) {
        const videoTrack = screenStream.getVideoTracks()[0];
        Object.values(peers).forEach(pc => {
            const senders = pc.getSenders();
            const videoSender = senders.find(s => s.track === videoTrack);
            if (videoSender) {
                pc.removeTrack(videoSender);
            }
        });
    }

    screenStream = null;
    $('screenContainer').style.display = 'none';
    $('screenBtn').textContent = '🖥️ Share';
    $('screenBtn').classList.remove('active');
    wsSend('screen-share-stopped');
    console.log('Screen sharing stopped and removed from all peers');
}

// System Audio Share (컴퓨터 소리 공유)
async function toggleSystemAudio() {
    if (systemAudioStream) {
        stopSystemAudio();
        return;
    }

    try {
        // 화면 공유가 이미 활성화되어 있는지 확인
        if (screenStream) {
            showToast('화면 공유를 먼저 중지해주세요', 'error');
            return;
        }

        // Chrome/Edge에서 시스템 오디오 캡처
        // audio: true를 설정하면 시스템 오디오 공유 옵션이 나타남
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,  // 비디오도 필수로 요청해야 오디오 옵션이 나타남
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        // 오디오 트랙만 추출
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            showToast('시스템 오디오가 선택되지 않았습니다', 'error');
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        // 비디오 트랙 처리
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
            // 비디오 트랙이 있으면 화면 공유로 전환
            screenStream = stream;
            $('screenVideo').srcObject = screenStream;
            $('screenContainer').style.display = 'block';
            $('screenBtn').textContent = '🖥️ Stop';
            $('screenBtn').classList.add('active');
            wsSend('screen-share-started');

            // 비디오 트랙 종료 시 처리
            videoTracks[0].onended = () => {
                stopScreen();
                stopSystemAudio();
            };
        }

        // 오디오 트랙만으로 새 스트림 생성
        systemAudioStream = new MediaStream(audioTracks);

        // 마이크와 믹싱
        await mixAudioStreams();

        $('systemAudioBtn').textContent = '🔊 Stop System Audio';
        $('systemAudioBtn').classList.add('active');
        showToast('시스템 오디오 공유 시작', 'success');

        // 오디오 트랙이 종료되면 자동으로 정리
        audioTracks[0].onended = stopSystemAudio;

    } catch (e) {
        console.error('System audio capture failed:', e);
        if (e.name === 'NotAllowedError') {
            showToast('시스템 오디오 공유가 거부되었습니다', 'error');
        } else {
            showToast('시스템 오디오 캡처 실패: ' + e.message, 'error');
        }
    }
}

function stopSystemAudio() {
    systemAudioStream?.getTracks().forEach(t => t.stop());
    systemAudioStream = null;

    // 믹싱 중지하고 원래 마이크 스트림으로 복원
    if (mixedStream) {
        mixedStream.getTracks().forEach(t => t.stop());
        mixedStream = null;
    }

    // Gain 노드 정리
    micGainNode = null;
    systemGainNode = null;
    systemAudioAnalyser = null;

    // 볼륨 미터 애니메이션 중지
    if (systemMeterAnimationId) {
        cancelAnimationFrame(systemMeterAnimationId);
        systemMeterAnimationId = null;
    }

    // 기존 연결들의 트랙 교체
    if (localStream) {
        Object.values(peers).forEach(pc => {
            const senders = pc.getSenders();
            const audioSender = senders.find(s => s.track?.kind === 'audio');
            if (audioSender && localStream.getAudioTracks()[0]) {
                audioSender.replaceTrack(localStream.getAudioTracks()[0]);
            }
        });
    }

    // 시스템 오디오 볼륨 슬라이더 숨김
    const systemVolSlider = $('systemVolSlider');
    if (systemVolSlider) {
        systemVolSlider.style.display = 'none';
    }

    // 볼륨 프리셋 버튼 숨김
    const volumePresets = $('volumePresets');
    if (volumePresets) {
        volumePresets.style.display = 'none';
    }

    // 시스템 오디오 볼륨 미터 숨김
    const systemVolMeter = $('systemVolMeter');
    if (systemVolMeter) {
        systemVolMeter.style.display = 'none';
    }

    // 화면 공유도 함께 중지 (시스템 오디오와 함께 시작된 경우)
    if (screenStream) {
        stopScreen();
    }

    $('systemAudioBtn').textContent = '🔊 Share System Audio';
    $('systemAudioBtn').classList.remove('active');
    showToast('시스템 오디오 공유 중지', 'info');
}

// 마이크와 시스템 오디오 믹싱
async function mixAudioStreams() {
    if (!localStream || !systemAudioStream) return;

    // Web Audio API로 믹싱
    if (!audioContext) {
        audioContext = new AudioContext({ latencyHint: 'interactive' });
    }

    const destination = audioContext.createMediaStreamDestination();

    // 마이크 소스
    const micSource = audioContext.createMediaStreamSource(localStream);
    micGainNode = audioContext.createGain();
    // UI에서 설정된 볼륨 값 적용
    const micVolValue = parseInt($('micVol')?.value || 100) / 100;
    micGainNode.gain.value = micVolValue;
    micSource.connect(micGainNode);
    micGainNode.connect(destination);

    // 시스템 오디오 소스
    const systemSource = audioContext.createMediaStreamSource(systemAudioStream);
    systemGainNode = audioContext.createGain();
    // UI에서 설정된 볼륨 값 적용
    const systemVolValue = parseInt($('systemVol')?.value || 70) / 100;
    systemGainNode.gain.value = systemVolValue;

    // 시스템 오디오 분석기 추가 (볼륨 미터용)
    systemAudioAnalyser = audioContext.createAnalyser();
    systemAudioAnalyser.fftSize = 256;
    systemAudioAnalyser.smoothingTimeConstant = 0.3;

    systemSource.connect(systemGainNode);
    systemGainNode.connect(systemAudioAnalyser); // 분석기 연결
    systemGainNode.connect(destination);

    // 믹싱된 스트림
    mixedStream = destination.stream;

    // 기존 연결들의 오디오 트랙을 믹싱된 트랙으로 교체
    const mixedAudioTrack = mixedStream.getAudioTracks()[0];
    Object.values(peers).forEach(pc => {
        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track?.kind === 'audio');
        if (audioSender) {
            audioSender.replaceTrack(mixedAudioTrack);
        }
    });

    // 시스템 오디오 볼륨 슬라이더 표시
    const systemVolSlider = $('systemVolSlider');
    if (systemVolSlider) {
        systemVolSlider.style.display = 'flex';
    }

    // 볼륨 프리셋 버튼 표시
    const volumePresets = $('volumePresets');
    if (volumePresets) {
        volumePresets.style.display = 'block';
    }

    // 시스템 오디오 볼륨 미터 표시 및 시작
    const systemVolMeter = $('systemVolMeter');
    if (systemVolMeter) {
        systemVolMeter.style.display = 'flex';
    }
    startSystemAudioMeter();

    console.log('Audio streams mixed: mic + system audio');
}

// 시스템 오디오 볼륨 미터
function startSystemAudioMeter() {
    if (!systemAudioAnalyser) return;

    const dataArray = new Uint8Array(systemAudioAnalyser.frequencyBinCount);
    const systemVolBar = $('systemVolBar');
    const systemAudioStatus = $('systemAudioStatus');

    function updateMeter() {
        if (!systemAudioAnalyser) {
            // 분석기가 없으면 중지
            cancelAnimationFrame(systemMeterAnimationId);
            return;
        }

        systemAudioAnalyser.getByteFrequencyData(dataArray);

        // RMS 계산
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const volume = Math.min(100, (average / 128) * 100);

        // 볼륨 바 업데이트
        if (systemVolBar) {
            systemVolBar.style.width = volume + '%';
        }

        // 오디오 활성 상태 표시 (소리가 감지되면 깜빡임)
        if (systemAudioStatus) {
            if (volume > 5) {
                // 소리 감지됨
                systemAudioStatus.style.color = 'var(--accent-green)';
                systemAudioStatus.style.opacity = '1';
            } else {
                // 소리 없음
                systemAudioStatus.style.color = 'var(--text-secondary)';
                systemAudioStatus.style.opacity = '0.3';
            }
        }

        systemMeterAnimationId = requestAnimationFrame(updateMeter);
    }

    updateMeter();
}


// 마이크 볼륨 조절
function updateMicVolume(value) {
    const volPercent = parseInt(value);
    const volValue = volPercent / 100;

    // UI 업데이트
    const volLabel = $('micVolVal');
    if (volLabel) {
        volLabel.textContent = volPercent + '%';
    }

    // 믹싱 중일 때만 Gain 노드 조절
    if (micGainNode) {
        micGainNode.gain.value = volValue;
        console.log(`Mic volume: ${volPercent}%`);
    }
}

// 시스템 오디오 볼륨 조절
function updateSystemVolume(value) {
    const volPercent = parseInt(value);
    const volValue = volPercent / 100;

    // UI 업데이트
    const volLabel = $('systemVolVal');
    if (volLabel) {
        volLabel.textContent = volPercent + '%';
    }

    // 믹싱 중일 때만 Gain 노드 조절
    if (systemGainNode) {
        systemGainNode.gain.value = volValue;
        console.log(`System audio volume: ${volPercent}%`);
    }
}


// 볼륨 프리셋 적용
function applyVolumePreset(preset) {
    let micVol, systemVol;

    switch (preset) {
        case 'balanced':
            // 균형 잡힌 설정
            micVol = 100;
            systemVol = 50;
            showToast('균형 모드: 마이크 100%, 시스템 50%', 'info');
            break;
        case 'music':
            // 음악 중심
            micVol = 80;
            systemVol = 100;
            showToast('음악 모드: 마이크 80%, 시스템 100%', 'info');
            break;
        case 'voice':
            // 마이크 중심
            micVol = 120;
            systemVol = 40;
            showToast('마이크 모드: 마이크 120%, 시스템 40%', 'info');
            break;
        default:
            return;
    }

    // 슬라이더 값 설정
    const micSlider = $('micVol');
    const systemSlider = $('systemVol');

    if (micSlider) {
        micSlider.value = micVol;
        updateMicVolume(micVol);
    }

    if (systemSlider) {
        systemSlider.value = systemVol;
        updateSystemVolume(systemVol);
    }
}

// Chat
function sendChat() {
    const msg = chatIn.value.trim();
    if (!msg) return;
    wsSend('chat', { message: msg });
    chatIn.value = '';
}

function addChatMsg(m, hist = false) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="sender">${m.nickname}</span><span class="time">${new Date(m.timestamp).toLocaleTimeString()}</span><div>${escHtml(m.message)}</div>`;
    chatMsgs.appendChild(div);
    if (!hist) chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function addSysMsg(t) {
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = t;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function escHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// Waiting Room
function addWaitingPeer(p) {
    const list = $('waitingList');
    const div = document.createElement('div');
    div.className = 'waiting-item';
    div.id = `wait-${p.peerId}`;
    div.innerHTML = `<span class="name">${p.nickname}</span><div class="actions"><button class="btn-success" onclick="approvePeer('${p.peerId}')">✓</button><button class="btn-danger" onclick="rejectPeer('${p.peerId}')">✗</button></div>`;
    list.appendChild(div);
}

function approvePeer(pid) { wsSend('approve-peer', { targetPeerId: pid }); $(`wait-${pid}`)?.remove(); }
function rejectPeer(pid) { wsSend('reject-peer', { targetPeerId: pid }); $(`wait-${pid}`)?.remove(); }
function kickPeer(pid) { if (confirm('Kick?')) wsSend('kick-peer', { targetPeerId: pid }); }
function mutePeer(pid, m) { wsSend('mute-peer', { targetPeerId: pid, muted: m }); }

// UI Updates
function updatePeerUI(rid) {
    let card = $(`peer-${rid}`);
    const info = peerInfos[rid] || {};
    if (!card) {
        card = document.createElement('div');
        card.id = `peer-${rid}`;
        card.className = 'peer-card' + (info.role === 'host' ? ' host' : '');
        card.innerHTML = `
      <div class="peer-header">
        <div class="peer-name"><span id="name-${rid}">${info.nickname || rid.slice(0, 8)}</span>${info.role === 'host' ? '<span class="peer-badge">HOST</span>' : ''}</div>
        <span id="status-${rid}" class="status"></span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary)">IP: ${info.ip || '?'}</div>
      <div class="volume-meter"><span>🔊</span><div class="volume-bar-bg"><div class="volume-bar" id="vol-${rid}"></div></div></div>
      <div class="volume-slider"><span>Vol</span><input type="range" min="0" max="150" value="100" onchange="setPeerVol('${rid}',this.value/100)"><span>100%</span></div>
      <div id="stats-${rid}" class="stats">...</div>
      <div class="quality-bars" id="qb-${rid}">${[1, 2, 3, 4, 5].map(i => `<div class="quality-bar" id="q${i}-${rid}"></div>`).join('')}</div>
      ${isHost && rid !== peerId ? `<div style="margin-top:8px"><button class="btn-secondary" onclick="mutePeer('${rid}',true)" style="padding:4px 8px;font-size:11px">Mute</button> <button class="btn-danger" onclick="kickPeer('${rid}')" style="padding:4px 8px;font-size:11px">Kick</button></div>` : ''}
    `;
        peersEl.appendChild(card);
    }
    const st = peers[rid]?.connectionState || 'new';
    const sEl = $(`status-${rid}`);
    sEl.textContent = st.toUpperCase();
    sEl.className = 'status ' + (st === 'connected' ? 'connected' : st === 'connecting' ? 'connecting' : 'failed');
}

function updatePeerStats(rid, s) {
    const el = $(`stats-${rid}`);
    if (el) {
        el.innerHTML = `Lat: ${s.lat}ms | Jit: ${s.jit}ms
↑${s.sendBitrate}kbps ↓${s.recvBitrate}kbps
Loss: ${s.loss} | ${s.type} | ${s.codec}`;
    }

    const lat = parseFloat(s.lat) || 0;
    let q = lat < 50 ? 5 : lat < 100 ? 4 : lat < 150 ? 3 : lat < 200 ? 2 : 1;
    for (let i = 1; i <= 5; i++) {
        const b = $(`q${i}-${rid}`);
        if (b) b.className = 'quality-bar ' + (i <= q ? (q >= 4 ? 'good' : q >= 3 ? 'ok' : 'bad') : '');
    }
}

function updateCount() { $('connCount').textContent = Object.keys(peers).length; }
function updateStatus(t) { $('localStatus').textContent = `${new Date().toLocaleTimeString()}: ${t}`; }
function applySettings(s) { if (s.bpm) { $('bpmInput').value = s.bpm; $('bpmDisplay').textContent = s.bpm; } }

function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function leaveRoom() {
    Object.keys(peers).forEach(closePC);
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    ws?.close();
    stopMetronomeLocal();
    stopRec();
    stopScreen();
    stopSystemAudio(); // 시스템 오디오 정리
    resetUI();
}

function resetUI() {
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    audioBtn.disabled = true;
    $('recordBtn').disabled = true;
    peersEl.innerHTML = '';
    updateCount();
}

// 마이크 볼륨 조절
function updateMicVolume(value) {
    const volPercent = parseInt(value);
    const volValue = volPercent / 100;

    // UI 업데이트
    const volLabel = $('micVolVal');
    if (volLabel) {
        volLabel.textContent = volPercent + '%';
    }

    // 믹싱 중일 때만 Gain 노드 조절
    if (micGainNode) {
        micGainNode.gain.value = volValue;
        console.log(`Mic volume: ${volPercent}%`);
    }
}

// 시스템 오디오 볼륨 조절
function updateSystemVolume(value) {
    const volPercent = parseInt(value);
    const volValue = volPercent / 100;

    // UI 업데이트
    const volLabel = $('systemVolVal');
    if (volLabel) {
        volLabel.textContent = volPercent + '%';
    }

    // 믹싱 중일 때만 Gain 노드 조절
    if (systemGainNode) {
        systemGainNode.gain.value = volValue;
        console.log(`System audio volume: ${volPercent}%`);
    }
}

// 볼륨 프리셋 적용
function applyVolumePreset(preset) {
    let micVol, systemVol;

    switch (preset) {
        case 'balanced':
            micVol = 100;
            systemVol = 50;
            showToast('균형 모드: 마이크 100%, 시스템 50%', 'info');
            break;
        case 'music':
            micVol = 80;
            systemVol = 100;
            showToast('음악 모드: 마이크 80%, 시스템 100%', 'info');
            break;
        case 'voice':
            micVol = 120;
            systemVol = 40;
            showToast('마이크 모드: 마이크 120%, 시스템 40%', 'info');
            break;
        default:
            return;
    }

    const micSlider = $('micVol');
    const systemSlider = $('systemVol');

    if (micSlider) {
        micSlider.value = micVol;
        updateMicVolume(micVol);
    }

    if (systemSlider) {
        systemSlider.value = systemVol;
        updateSystemVolume(systemVol);
    }
}

// 시스템 오디오 볼륨 미터
function startSystemAudioMeter() {
    if (!systemAudioAnalyser) return;

    const dataArray = new Uint8Array(systemAudioAnalyser.frequencyBinCount);
    const systemVolBar = $('systemVolBar');
    const systemAudioStatus = $('systemAudioStatus');

    function updateMeter() {
        if (!systemAudioAnalyser) {
            cancelAnimationFrame(systemMeterAnimationId);
            return;
        }

        systemAudioAnalyser.getByteFrequencyData(dataArray);

        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const volume = Math.min(100, (average / 128) * 100);

        if (systemVolBar) {
            systemVolBar.style.width = volume + '%';
        }

        if (systemAudioStatus) {
            if (volume > 5) {
                systemAudioStatus.style.color = 'var(--accent-green)';
                systemAudioStatus.style.opacity = '1';
            } else {
                systemAudioStatus.style.color = 'var(--text-secondary)';
                systemAudioStatus.style.opacity = '0.3';
            }
        }

        systemMeterAnimationId = requestAnimationFrame(updateMeter);
    }

    updateMeter();
}

// ==========================================
// Sync/Latency Compensation Functions (동기화 설정)
// ==========================================

// 글로벌 버퍼 설정 (모든 피어에 적용)
function setGlobalBuffer(ms) {
    const value = Math.max(0, Math.min(syncConfig.maxBuffer, parseInt(ms) || 0));
    syncConfig.globalBuffer = value;

    // 모든 피어의 DelayNode 업데이트
    Object.entries(peerDelayNodes).forEach(([rid, delay]) => {
        const offset = peerOffsets[rid] || 0;
        const totalDelay = Math.max(0, value + offset) / 1000;
        delay.delayTime.setValueAtTime(totalDelay, audioContext.currentTime);
    });

    // UI 업데이트
    const label = $('globalBufferVal');
    if (label) label.textContent = value + 'ms';

    console.log(`Global buffer set to ${value}ms`);
}

// 피어별 오프셋 설정
function setPeerOffset(rid, ms) {
    const value = parseInt(ms) || 0;
    peerOffsets[rid] = value;

    if (peerDelayNodes[rid]) {
        const totalDelay = Math.max(0, syncConfig.globalBuffer + value) / 1000;
        peerDelayNodes[rid].delayTime.setValueAtTime(totalDelay, audioContext.currentTime);
    }

    // UI 업데이트
    const label = $(`offsetVal-${rid}`);
    if (label) label.textContent = (value >= 0 ? '+' : '') + value + 'ms';

    console.log(`Peer ${rid} offset set to ${value}ms`);
}

// 자동 버퍼 토글
function toggleAutoBuffer() {
    syncConfig.autoBuffer = !syncConfig.autoBuffer;
    const el = $('autoBufferToggle');
    if (el) el.classList.toggle('on', syncConfig.autoBuffer);

    if (syncConfig.autoBuffer) {
        // 현재 평균 지연 기반으로 버퍼 계산
        calculateAutoBuffer();
        showToast('자동 버퍼 활성화', 'info');
    } else {
        showToast('수동 버퍼 모드', 'info');
    }
}

// RTT 기반 자동 버퍼 계산
function calculateAutoBuffer() {
    if (!syncConfig.autoBuffer) return;

    // 모든 피어의 최대 지연을 기준으로 버퍼 계산
    const maxLatency = perfData.peakLatency || 100;
    const targetBuffer = Math.min(syncConfig.maxBuffer, Math.ceil(maxLatency * 1.2)); // 20% 여유

    setGlobalBuffer(targetBuffer);

    // 슬라이더 UI 동기화
    const slider = $('globalBuffer');
    if (slider) slider.value = targetBuffer;
}

// 동기화 테스트 (핑-퐁)
function testSync() {
    showToast('동기화 테스트 중...', 'info');

    // 현재 지연 상태 표시
    const avgLat = perfData.avgLatency.toFixed(0);
    const peakLat = perfData.peakLatency.toFixed(0);
    const buffer = syncConfig.globalBuffer;

    setTimeout(() => {
        showToast(`평균: ${avgLat}ms, 최대: ${peakLat}ms, 버퍼: ${buffer}ms`, 'success');

        // 자동 버퍼 모드면 재계산
        if (syncConfig.autoBuffer) {
            calculateAutoBuffer();
        }
    }, 1000);
}

// 피어 연결 종료 시 정리
function cleanupPeerSync(rid) {
    delete peerDelayNodes[rid];
    delete peerOffsets[rid];
}

// 모든 스크립트 로드 후 초기화
document.addEventListener('DOMContentLoaded', init);

