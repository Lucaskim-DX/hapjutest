// drum.js - 가상 드럼 악기 모듈 (피어 전송 지원)
// Web Audio API를 사용하여 드럼 사운드를 재생하고 피어에게 전송

// 드럼 전용 변수
let drumContext = null;
let drumGainNode = null;
let drumStreamDestination = null;  // 피어 전송용
let drumMixedStream = null;        // 드럼 + 마이크 믹싱 스트림
let originalMicStream = null;      // 원래 마이크 스트림 백업

// 드럼 사운드 정의
const DRUM_SOUNDS = {
    kick: { name: '킥 (베이스)', frequency: 60, decay: 0.5, type: 'sine' },
    snare: { name: '스네어', frequency: 200, decay: 0.2, type: 'triangle', noise: true },
    hihat: { name: '하이햇', frequency: 800, decay: 0.1, type: 'square', highpass: true },
    tom: { name: '탐', frequency: 120, decay: 0.3, type: 'sine' },
    clap: { name: '클랩', frequency: 400, decay: 0.15, type: 'sawtooth', noise: true },
    rim: { name: '림샷', frequency: 500, decay: 0.08, type: 'square' }
};

// 드럼 모듈 초기화 (피어 전송 지원)
function initDrum() {
    if (drumContext && drumStreamDestination) return;

    // audioContext가 이미 있으면 재사용
    if (typeof audioContext !== 'undefined' && audioContext) {
        drumContext = audioContext;
    } else {
        drumContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive'
        });
    }

    // 드럼 전용 게인 노드
    drumGainNode = drumContext.createGain();
    drumGainNode.gain.value = 0.8;

    // 1. 로컬 스피커 출력
    drumGainNode.connect(drumContext.destination);

    // 2. 피어 전송용 MediaStreamDestination 생성
    drumStreamDestination = drumContext.createMediaStreamDestination();
    drumGainNode.connect(drumStreamDestination);

    console.log('Drum module initialized with peer transmission support');

    // 드럼을 마이크 스트림과 믹싱
    mixDrumWithMic();
}

// 드럼 스트림을 마이크와 믹싱하여 피어에게 전송
function mixDrumWithMic() {
    // localStream이 없으면 대기
    if (typeof localStream === 'undefined' || !localStream) {
        console.log('Waiting for localStream to mix drum audio...');
        setTimeout(mixDrumWithMic, 1000);
        return;
    }

    if (!drumStreamDestination) {
        console.warn('Drum stream destination not ready');
        return;
    }

    // 이미 믹싱 중이면 스킵
    if (drumMixedStream) {
        console.log('Drum already mixed with mic');
        return;
    }

    try {
        // 믹싱 전용 destination 생성
        const mixDestination = drumContext.createMediaStreamDestination();

        // 마이크 소스 연결
        const micSource = drumContext.createMediaStreamSource(localStream);
        const micGain = drumContext.createGain();
        micGain.gain.value = 1.0;
        micSource.connect(micGain);
        micGain.connect(mixDestination);

        // 드럼 게인 노드를 믹스 destination에도 연결
        drumGainNode.connect(mixDestination);

        drumMixedStream = mixDestination.stream;
        originalMicStream = localStream;

        // 기존 피어 연결에 믹싱된 트랙 교체
        const mixedAudioTrack = drumMixedStream.getAudioTracks()[0];
        if (typeof peers !== 'undefined') {
            Object.values(peers).forEach(pc => {
                const senders = pc.getSenders();
                const audioSender = senders.find(s => s.track?.kind === 'audio');
                if (audioSender) {
                    audioSender.replaceTrack(mixedAudioTrack);
                }
            });
        }

        console.log('Drum audio mixed with microphone and sent to peers');
        showToast('드럼 오디오가 피어에게 전송됩니다', 'success');

    } catch (e) {
        console.error('Failed to mix drum with mic:', e);
    }
}

// 킥 드럼 합성
function synthesizeKick(time) {
    const osc = drumContext.createOscillator();
    const gain = drumContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);

    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);

    osc.connect(gain);
    gain.connect(drumGainNode);

    osc.start(time);
    osc.stop(time + 0.5);
}

// 스네어 드럼 합성
function synthesizeSnare(time) {
    // 노이즈 부분
    const noiseBuffer = drumContext.createBuffer(1, drumContext.sampleRate * 0.2, drumContext.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = Math.random() * 2 - 1;
    }

    const noise = drumContext.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = drumContext.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;

    const noiseGain = drumContext.createGain();
    noiseGain.gain.setValueAtTime(0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(drumGainNode);

    noise.start(time);
    noise.stop(time + 0.2);

    // 톤 부분
    const osc = drumContext.createOscillator();
    const oscGain = drumContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(100, time + 0.1);

    oscGain.gain.setValueAtTime(0.7, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

    osc.connect(oscGain);
    oscGain.connect(drumGainNode);

    osc.start(time);
    osc.stop(time + 0.1);
}

// 하이햇 합성
function synthesizeHihat(time) {
    const fundamental = 40;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];

    ratios.forEach(ratio => {
        const osc = drumContext.createOscillator();
        const gain = drumContext.createGain();
        const bandpass = drumContext.createBiquadFilter();

        osc.type = 'square';
        osc.frequency.value = fundamental * ratio;

        bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000;
        bandpass.Q.value = 1;

        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

        osc.connect(bandpass);
        bandpass.connect(gain);
        gain.connect(drumGainNode);

        osc.start(time);
        osc.stop(time + 0.1);
    });
}

// 탐 합성
function synthesizeTom(time) {
    const osc = drumContext.createOscillator();
    const gain = drumContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.2);

    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);

    osc.connect(gain);
    gain.connect(drumGainNode);

    osc.start(time);
    osc.stop(time + 0.3);
}

// 클랩 합성
function synthesizeClap(time) {
    // 여러 개의 짧은 노이즈 버스트
    for (let i = 0; i < 3; i++) {
        const noiseBuffer = drumContext.createBuffer(1, drumContext.sampleRate * 0.02, drumContext.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let j = 0; j < noiseData.length; j++) {
            noiseData[j] = Math.random() * 2 - 1;
        }

        const noise = drumContext.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = drumContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1500;
        filter.Q.value = 3;

        const gain = drumContext.createGain();
        gain.gain.setValueAtTime(0.6, time + i * 0.015);
        gain.gain.exponentialRampToValueAtTime(0.01, time + i * 0.015 + 0.05);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(drumGainNode);

        noise.start(time + i * 0.015);
        noise.stop(time + i * 0.015 + 0.05);
    }

    // 메인 노이즈
    const mainNoiseBuffer = drumContext.createBuffer(1, drumContext.sampleRate * 0.15, drumContext.sampleRate);
    const mainNoiseData = mainNoiseBuffer.getChannelData(0);
    for (let i = 0; i < mainNoiseData.length; i++) {
        mainNoiseData[i] = Math.random() * 2 - 1;
    }

    const mainNoise = drumContext.createBufferSource();
    mainNoise.buffer = mainNoiseBuffer;

    const mainFilter = drumContext.createBiquadFilter();
    mainFilter.type = 'highpass';
    mainFilter.frequency.value = 1000;

    const mainGain = drumContext.createGain();
    mainGain.gain.setValueAtTime(0.5, time + 0.03);
    mainGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

    mainNoise.connect(mainFilter);
    mainFilter.connect(mainGain);
    mainGain.connect(drumGainNode);

    mainNoise.start(time + 0.03);
    mainNoise.stop(time + 0.15);
}

// 림샷 합성
function synthesizeRim(time) {
    const osc = drumContext.createOscillator();
    const gain = drumContext.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(800, time);

    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);

    osc.connect(gain);
    gain.connect(drumGainNode);

    osc.start(time);
    osc.stop(time + 0.08);
}

// 드럼 재생 (메인 함수)
function playDrum(soundName = 'kick') {
    if (!drumContext) {
        initDrum();
    }

    // AudioContext가 suspended 상태면 resume
    if (drumContext.state === 'suspended') {
        drumContext.resume();
    }

    // 믹싱이 안 되어 있으면 시도
    if (!drumMixedStream && typeof localStream !== 'undefined' && localStream) {
        mixDrumWithMic();
    }

    const time = drumContext.currentTime;

    switch (soundName) {
        case 'kick':
            synthesizeKick(time);
            break;
        case 'snare':
            synthesizeSnare(time);
            break;
        case 'hihat':
            synthesizeHihat(time);
            break;
        case 'tom':
            synthesizeTom(time);
            break;
        case 'clap':
            synthesizeClap(time);
            break;
        case 'rim':
            synthesizeRim(time);
            break;
        default:
            synthesizeKick(time);
    }

    console.log(`Drum played: ${soundName}`);

    // 시각적 피드백
    showDrumFeedback(soundName);
}

// 드럼 볼륨 설정
function setDrumVolume(volume) {
    if (drumGainNode) {
        drumGainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
}

// 시각적 피드백
function showDrumFeedback(soundName) {
    const btn = document.querySelector(`[data-drum="${soundName}"]`);
    if (btn) {
        btn.classList.add('drum-active');
        setTimeout(() => btn.classList.remove('drum-active'), 100);
    }
}

// 드럼 UI 동적 추가
function addDrumUI() {
    // 이미 추가되어 있으면 스킵
    if (document.getElementById('drumCard')) return;

    // 오디오 설정 카드 다음에 드럼 카드 추가
    const syncCard = document.querySelector('.sidebar .card:has(#globalBuffer)');
    const targetCard = syncCard || document.querySelector('.sidebar .card:has(#chatMessages)');

    if (!targetCard) {
        console.warn('Could not find target card for drum UI');
        return;
    }

    const drumCard = document.createElement('div');
    drumCard.className = 'card';
    drumCard.id = 'drumCard';
    drumCard.innerHTML = `
        <h3>🥁 가상 드럼</h3>
        
        <div class="drum-grid">
            <button class="drum-btn" data-drum="kick" onclick="playDrum('kick')">
                <span class="drum-icon">🔊</span>
                <span class="drum-label">킥</span>
            </button>
            <button class="drum-btn" data-drum="snare" onclick="playDrum('snare')">
                <span class="drum-icon">🔔</span>
                <span class="drum-label">스네어</span>
            </button>
            <button class="drum-btn" data-drum="hihat" onclick="playDrum('hihat')">
                <span class="drum-icon">🎵</span>
                <span class="drum-label">하이햇</span>
            </button>
            <button class="drum-btn" data-drum="tom" onclick="playDrum('tom')">
                <span class="drum-icon">🥁</span>
                <span class="drum-label">탐</span>
            </button>
            <button class="drum-btn" data-drum="clap" onclick="playDrum('clap')">
                <span class="drum-icon">👏</span>
                <span class="drum-label">클랩</span>
            </button>
            <button class="drum-btn" data-drum="rim" onclick="playDrum('rim')">
                <span class="drum-icon">🪘</span>
                <span class="drum-label">림샷</span>
            </button>
        </div>
        
        <div class="volume-slider" style="margin-top:12px">
            <span>볼륨</span>
            <input type="range" id="drumVolume" min="0" max="100" value="80" 
                   oninput="setDrumVolume(this.value/100); document.getElementById('drumVolVal').textContent=this.value+'%'">
            <span id="drumVolVal">80%</span>
        </div>
        
        <div style="margin-top:8px;padding:6px;background:rgba(0,255,0,0.1);border-radius:4px;font-size:10px;color:var(--accent-green)">
            ✅ 드럼 소리가 피어에게 전송됩니다
        </div>
        
        <div style="margin-top:6px;font-size:10px;color:var(--text-secondary)">
            💡 키보드: Q/W/E/R/T/Y로 연주 가능
        </div>
    `;

    // CSS 스타일 추가
    if (!document.querySelector('#drumStyles')) {
        const style = document.createElement('style');
        style.id = 'drumStyles';
        style.textContent = `
            .drum-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
            }
            .drum-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 12px 8px;
                background: linear-gradient(135deg, var(--bg-secondary), var(--bg-tertiary));
                border: 1px solid var(--border-color);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.1s ease;
                color: var(--text-primary);
            }
            .drum-btn:hover {
                background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
                transform: scale(1.02);
            }
            .drum-btn:active, .drum-btn.drum-active {
                transform: scale(0.95);
                background: var(--accent-green);
            }
            .drum-icon {
                font-size: 20px;
                margin-bottom: 4px;
            }
            .drum-label {
                font-size: 11px;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }

    targetCard.parentNode.insertBefore(drumCard, targetCard);
    console.log('Drum UI added');
}

// 키보드 단축키 설정
function setupDrumKeyboard() {
    const keyMap = {
        'q': 'kick',
        'w': 'snare',
        'e': 'hihat',
        'r': 'tom',
        't': 'clap',
        'y': 'rim'
    };

    document.addEventListener('keydown', (e) => {
        // 입력 필드에서는 무시
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const sound = keyMap[e.key.toLowerCase()];
        if (sound) {
            e.preventDefault();
            playDrum(sound);
        }
    });

    console.log('Drum keyboard shortcuts enabled: Q/W/E/R/T/Y');
}

// 드럼 믹싱 정리 (방 나갈 때 호출)
function cleanupDrum() {
    if (drumMixedStream) {
        drumMixedStream.getTracks().forEach(t => t.stop());
        drumMixedStream = null;
    }

    // 원래 마이크 스트림 복원
    if (originalMicStream && typeof peers !== 'undefined') {
        const audioTrack = originalMicStream.getAudioTracks()[0];
        Object.values(peers).forEach(pc => {
            const senders = pc.getSenders();
            const audioSender = senders.find(s => s.track?.kind === 'audio');
            if (audioSender && audioTrack) {
                audioSender.replaceTrack(audioTrack);
            }
        });
    }

    originalMicStream = null;
    console.log('Drum audio cleaned up');
}

// 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        addDrumUI();
        setupDrumKeyboard();
    });
} else {
    addDrumUI();
    setupDrumKeyboard();
}
