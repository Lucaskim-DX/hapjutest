// Add sync settings UI dynamically
function addSyncSettingsUI() {
    const chatCard = document.querySelector('.sidebar .card:has(#chatMessages)');
    if (!chatCard) return;

    const syncCard = document.createElement('div');
    syncCard.className = 'card';
    syncCard.innerHTML = `
        <h3>🎯 동기화 설정</h3>

        <div class="volume-slider">
            <span>버퍼</span>
            <input type="range" id="globalBuffer" min="0" max="200" value="50" oninput="setGlobalBuffer(this.value)">
            <span id="globalBufferVal">50ms</span>
        </div>

        <div class="toggle">
            <span>자동 버퍼 (RTT 기반)</span>
            <div class="toggle-switch" id="autoBufferToggle" onclick="toggleAutoBuffer()"></div>
        </div>

        <button class="btn-secondary" onclick="testSync()" style="width:100%;margin-top:10px;font-size:11px">
            📊 동기화 테스트
        </button>

        <div style="margin-top:8px;font-size:10px;color:var(--text-secondary)">
            💡 버퍼를 높이면 동기화 ↑, 반응 ↓
        </div>
    `;

    chatCard.parentNode.insertBefore(syncCard, chatCard);
    console.log('Sync settings UI added');
}

// Initialize sync settings UI after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addSyncSettingsUI);
} else {
    addSyncSettingsUI();
}
