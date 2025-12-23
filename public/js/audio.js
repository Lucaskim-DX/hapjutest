// audio.js - 오디오 처리 (믹싱, 볼륨)
// 변수들은 app.js에서 전역으로 선언됨

// 마이크 볼륨 조절
function updateMicVolume(value) {
    const volPercent = parseInt(value);
    const volValue = volPercent / 100;

    const volLabel = $('micVolVal');
    if (volLabel) {
        volLabel.textContent = volPercent + '%';
    }

    if (micGainNode) {
        micGainNode.gain.value = volValue;
        console.log(`Mic volume: ${volPercent}%`);
    }
}

// 시스템 오디오 볼륨 조절
function updateSystemVolume(value) {
    const volPercent = parseInt(value);
    const volValue = volPercent / 100;

    const volLabel = $('systemVolVal');
    if (volLabel) {
        volLabel.textContent = volPercent + '%';
    }

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

// 마이크와 시스템 오디오 믹싱
async function mixAudioStreams() {
    if (!localStream || !systemAudioStream) return;

    if (!audioContext) {
        audioContext = new AudioContext({ latencyHint: 'interactive' });
    }

    const destination = audioContext.createMediaStreamDestination();

    // 마이크 소스
    const micSource = audioContext.createMediaStreamSource(localStream);
    micGainNode = audioContext.createGain();
    const micVolValue = parseInt($('micVol')?.value || 100) / 100;
    micGainNode.gain.value = micVolValue;
    micSource.connect(micGainNode);
    micGainNode.connect(destination);

    // 시스템 오디오 소스
    const systemSource = audioContext.createMediaStreamSource(systemAudioStream);
    systemGainNode = audioContext.createGain();
    const systemVolValue = parseInt($('systemVol')?.value || 70) / 100;
    systemGainNode.gain.value = systemVolValue;

    // 시스템 오디오 분석기 추가
    systemAudioAnalyser = audioContext.createAnalyser();
    systemAudioAnalyser.fftSize = 256;
    systemAudioAnalyser.smoothingTimeConstant = 0.3;

    systemSource.connect(systemGainNode);
    systemGainNode.connect(systemAudioAnalyser);
    systemGainNode.connect(destination);

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

    // UI 표시
    const systemVolSlider = $('systemVolSlider');
    if (systemVolSlider) systemVolSlider.style.display = 'flex';

    const volumePresets = $('volumePresets');
    if (volumePresets) volumePresets.style.display = 'block';

    const systemVolMeter = $('systemVolMeter');
    if (systemVolMeter) systemVolMeter.style.display = 'flex';

    startSystemAudioMeter();
    console.log('Audio streams mixed: mic + system audio');
}

// 마스터 볼륨 설정
function setMasterVol(val) {
    Object.values(gainNodes).forEach(g => g.gain.value = val);
}
