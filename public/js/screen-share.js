// screen-share.js - 화면 공유 및 시스템 오디오 공유
// 변수들은 app.js에서 전역으로 선언됨

// Screen Share
async function toggleScreen() {
    if (screenStream) { stopScreen(); return; }

    if (systemAudioStream) {
        showToast('시스템 오디오를 먼저 중지해주세요', 'error');
        return;
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 15, max: 30 }
            },
            audio: false
        });
        $('screenVideo').srcObject = screenStream;
        $('screenContainer').style.display = 'block';
        $('screenBtn').textContent = '🖥️ Stop';
        $('screenBtn').classList.add('active');
        wsSend('screen-share-started');

        // 기존 연결에 비디오 트랙 추가 (낮은 우선순위)
        const videoTrack = screenStream.getVideoTracks()[0];
        Object.values(peers).forEach(async pc => {
            const sender = pc.addTrack(videoTrack, screenStream);

            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];

            params.encodings[0].maxBitrate = 500000;
            params.encodings[0].priority = 'low';
            params.encodings[0].networkPriority = 'low';

            try {
                await sender.setParameters(params);
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
    screenStream = null;
    $('screenContainer').style.display = 'none';
    $('screenBtn').textContent = '🖥️ Share';
    $('screenBtn').classList.remove('active');
    wsSend('screen-share-stopped');
    console.log('Screen sharing stopped');
}

// System Audio Share
async function toggleSystemAudio() {
    if (systemAudioStream) {
        stopSystemAudio();
        return;
    }

    try {
        if (screenStream) {
            showToast('화면 공유를 먼저 중지해주세요', 'error');
            return;
        }

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            showToast('시스템 오디오가 선택되지 않았습니다', 'error');
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        // 비디오 트랙 처리
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
            screenStream = stream;
            $('screenVideo').srcObject = screenStream;
            $('screenContainer').style.display = 'block';
            $('screenBtn').textContent = '🖥️ Stop';
            $('screenBtn').classList.add('active');
            wsSend('screen-share-started');

            videoTracks[0].onended = () => {
                stopScreen();
                stopSystemAudio();
            };
        }

        systemAudioStream = new MediaStream(audioTracks);
        await mixAudioStreams();

        $('systemAudioBtn').textContent = '🔊 Stop System Audio';
        $('systemAudioBtn').classList.add('active');
        showToast('시스템 오디오 공유 시작', 'success');

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

    if (mixedStream) {
        mixedStream.getTracks().forEach(t => t.stop());
        mixedStream = null;
    }

    micGainNode = null;
    systemGainNode = null;
    systemAudioAnalyser = null;

    if (systemMeterAnimationId) {
        cancelAnimationFrame(systemMeterAnimationId);
        systemMeterAnimationId = null;
    }

    if (localStream) {
        Object.values(peers).forEach(pc => {
            const senders = pc.getSenders();
            const audioSender = senders.find(s => s.track?.kind === 'audio');
            if (audioSender && localStream.getAudioTracks()[0]) {
                audioSender.replaceTrack(localStream.getAudioTracks()[0]);
            }
        });
    }

    // UI 숨김
    const systemVolSlider = $('systemVolSlider');
    if (systemVolSlider) systemVolSlider.style.display = 'none';

    const volumePresets = $('volumePresets');
    if (volumePresets) volumePresets.style.display = 'none';

    const systemVolMeter = $('systemVolMeter');
    if (systemVolMeter) systemVolMeter.style.display = 'none';

    if (screenStream) {
        stopScreen();
    }

    $('systemAudioBtn').textContent = '🔊 Share System Audio';
    $('systemAudioBtn').classList.remove('active');
    showToast('시스템 오디오 공유 중지', 'info');
}

// Remote Video (Screen Share)
function setupRemoteVideo(rid, stream) {
    let videoContainer = $(`video-container-${rid}`);

    if (!videoContainer) {
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

        const peerCard = $(`peer-${rid}`);
        if (peerCard) {
            peerCard.appendChild(videoContainer);
        }
    } else {
        const video = $(`video-${rid}`);
        if (video) {
            video.srcObject = stream;
        }
    }

    console.log(`Remote video setup for peer ${rid}`);
}
