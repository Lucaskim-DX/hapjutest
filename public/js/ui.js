// ui.js - UI 관련 함수들

// 피어 카드 생성
function createPeerCard(rid, nick) {
    const card = document.createElement('div');
    card.className = 'peer-card';
    card.id = `peer-${rid}`;
    card.innerHTML = `
        <div class="peer-header">
            <div class="peer-name">🎧 ${nick || rid}</div>
            ${isHost ? `
                <div class="host-actions">
                    <button onclick="mutePeer('${rid}')" class="btn-sm">🔇</button>
                    <button onclick="kickPeer('${rid}')" class="btn-sm btn-danger-sm">❌</button>
                </div>
            ` : ''}
        </div>
        <div class="volume-meter">
            <span>🔊</span>
            <div class="volume-bar-bg"><div class="volume-bar" id="vol-${rid}"></div></div>
        </div>
        <div class="stats" id="stats-${rid}">Connecting...</div>
    `;
    peersEl.appendChild(card);
}

// 피어 상태 업데이트
function updatePeerStats(rid, stats) {
    const el = $(`stats-${rid}`);
    if (el) {
        // stats가 객체인 경우 포맷팅
        if (typeof stats === 'object') {
            el.innerHTML = `${stats.lat}ms | ${stats.jit}ms jitter | ${stats.loss}% loss`;
        } else {
            el.innerHTML = stats;
        }
    }
}

// UI 리셋
function resetUI() {
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    audioBtn.disabled = true;
    $('recordBtn').disabled = true;
    peersEl.innerHTML = '';
    updateCount();
}

// 오디오 설정 UI 업데이트
function updateAudioSettingsUI() {
    $('toggleEcho').classList.toggle('on', audioConfig.echoCancellation);
    $('toggleNoise').classList.toggle('on', audioConfig.noiseSuppression);
    $('toggleAGC').classList.toggle('on', audioConfig.autoGainControl);
    $('toggleDTX').classList.toggle('on', audioConfig.dtx);
    $('toggleLowLatency').classList.toggle('on', audioConfig.lowLatencyMode);
}

// 오디오 설정 토글
function toggleAudioSetting(setting) {
    switch (setting) {
        case 'echo':
            audioConfig.echoCancellation = !audioConfig.echoCancellation;
            $('toggleEcho').classList.toggle('on');
            break;
        case 'noise':
            audioConfig.noiseSuppression = !audioConfig.noiseSuppression;
            $('toggleNoise').classList.toggle('on');
            break;
        case 'agc':
            audioConfig.autoGainControl = !audioConfig.autoGainControl;
            $('toggleAGC').classList.toggle('on');
            break;
        case 'dtx':
            audioConfig.dtx = !audioConfig.dtx;
            $('toggleDTX').classList.toggle('on');
            break;
        case 'lowLatency':
            audioConfig.lowLatencyMode = !audioConfig.lowLatencyMode;
            $('toggleLowLatency').classList.toggle('on');
            break;
    }
}

// 메모리 사용량 업데이트
function updateMemoryUsage() {
    if (performance.memory) {
        const used = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
        const total = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024);
        const memEl = $('perfMem');
        if (memEl) {
            memEl.textContent = `${used}/${total}MB`;
        }
    }
}

// 대기실 UI 업데이트
function updateWaitingList(list) {
    const el = $('waitingList');
    if (!el) return;

    el.innerHTML = list.map(p => `
        <div class="waiting-item">
            <span>${p.nickname}</span>
            <div>
                <button onclick="approveJoin('${p.id}')" class="btn-sm btn-success-sm">✓</button>
                <button onclick="rejectJoin('${p.id}')" class="btn-sm btn-danger-sm">✗</button>
            </div>
        </div>
    `).join('');
}
