// app.js - Performance Optimized with Audio Worklet Support
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}`;
let ws, peerId = `peer-${Date.now()}`, roomId, nickname, localStream;
let isHost = false, hostId = null;
const peers = {}, peerInfos = {}, statsIntervals = {}, gainNodes = {};
let audioContext, metronomeInterval, currentBeat = 0;
let mediaRecorder, recordedChunks = [], recordingStart;
let screenStream = null;

// Audio Worklet support
let audioWorkletReady = false;
const workletNodes = {}; // Store worklet nodes for each peer

// ICE Candidate Batching
const iceBatchQueues = {}; // Queue per peer
const ICE_BATCH_DELAY = 50; // ms to wait before sending batch
const iceBatchTimers = {};

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

// ICE Servers
const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
];

// DOM
const $ = id => document.getElementById(id);
const roomInput = $('roomId'), nickInput = $('nickname'), micSelect = $('micSelect');
const joinBtn = $('joinBtn'), leaveBtn = $('leaveBtn'), audioBtn = $('audioBtn');
const peersEl = $('peers'), chatMsgs = $('chatMessages'), chatIn = $('chatInput');

// Init
async function init() {
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
        audioContext = new AudioContext({ latencyHint: 'interactive' });
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
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devs = await navigator.mediaDevices.enumerateDevices();
        micSelect.innerHTML = devs.filter(d => d.kind === 'audioinput').map((d, i) => `<option value="${d.deviceId}">${d.label || 'Mic ' + (i + 1)}</option>`).join('');
    } catch (e) { console.error(e); }
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

    localStream?.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = e => setupRemoteAudio(rid, e.streams[0]);

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

// Audio Worklet pipeline (low latency)
async function setupAudioWorkletPipeline(rid, src) {
    try {
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

        // Connect: source -> meter -> gain -> destination
        src.connect(meterNode);
        src.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Store for volume control
        workletNodes[rid] = { meter: meterNode, gain: gainNode };
        gainNodes[rid] = {
            gain: { value: 1 },
            setGain: (v) => gainNode.port.postMessage({ type: 'setGain', gain: v })
        };

        console.log(`Audio Worklet pipeline set up for peer ${rid}`);
    } catch (e) {
        console.warn('Audio Worklet failed, falling back:', e);
        setupStandardAudioPipeline(rid, src);
    }
}

// Standard Web Audio API pipeline (fallback)
function setupStandardAudioPipeline(rid, src) {
    const gain = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;

    src.connect(analyser);
    src.connect(gain);
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
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        $('screenVideo').srcObject = screenStream;
        $('screenContainer').style.display = 'block';
        $('screenBtn').textContent = '🖥️ Stop';
        wsSend('screen-share-started');
        screenStream.getVideoTracks()[0].onended = stopScreen;
    } catch (e) { console.error(e); }
}

function stopScreen() {
    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;
    $('screenContainer').style.display = 'none';
    $('screenBtn').textContent = '🖥️ Share';
    wsSend('screen-share-stopped');
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

init();
