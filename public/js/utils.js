// utils.js - 유틸리티 함수들
// $ 함수는 app.js에서 정의됨

// 보안 환경 체크 (HTTPS 또는 localhost 필요)
function isSecureContext() {
    if (window.isSecureContext !== undefined) {
        return window.isSecureContext;
    }
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

// Toast 메시지
function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// 시스템 메시지 추가
function addSysMsg(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.innerHTML = `<em>${msg}</em>`;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

// 연결 수 업데이트
function updateCount() {
    $('connCount').textContent = Object.keys(peers).length;
}

// 참가자 목록 업데이트
function updateParticipantsList(participants) {
    peersEl.innerHTML = '';
    participants.forEach(p => {
        if (p.id !== peerId) {
            createPeerCard(p.id, p.nickname);
        }
    });
}
