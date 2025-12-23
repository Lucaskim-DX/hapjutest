# 📋 `webrtc‑mesh‑test` 프로젝트 테스트 시나리오

> **테스트 전 준비**
> 1. **브라우저** – 최신 Chrome / Edge (HTTPS 또는 `http://localhost:3000` 로 실행)
> 2. **서버** – `npm run dev` 로 로컬 개발 서버 실행 (`http://localhost:3000`)
> 3. **테스트 기기** – 최소 2대 (PC 혹은 모바일) – 같은 네트워크에 연결
> 4. **테스트 계정** – 별도 닉네임을 입력해 방에 입장 (예: `UserA`, `UserB`)
> 5. **필수 권한** – 마이크, 화면/시스템 오디오 공유 권한을 **허용**한 상태

---

## 1️⃣ 기본 연결 / 방 입장

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | `http://localhost:3000` 로 페이지 로드 | UI가 정상 렌더링되고, **Join** 버튼 활성화 | `isSecureContext()` 체크 통과 |
| 2 | 닉네임 입력 → 방 ID 입력 → **Join** 클릭 | `peerId`가 생성되고, `WebSocket` 연결 성공 (`ws`가 open) | 콘솔에 `WebSocket opened` 로그 |
| 3 | 다른 브라우저/기기에서 동일 방에 입장 | 두 피어가 서로 **연결**되고, 피어 카드가 각각 생성 | 피어 카드에 `Connecting…` → `Connected` 로 변함 |
| 4 | **Leave** 버튼 클릭 | 모든 `RTCPeerConnection` 종료, UI 초기화 (`joinBtn` 활성화) | `resetUI()` 호출 확인 |

---

## 2️⃣ 마이크 오디오 전송 & 볼륨 제어

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | 방에 입장 후 **마이크** 자동 활성화 | 로컬 오디오 스트림이 `localStream`에 저장, `audio` 요소에 `muted` 상태로 재생 | 콘솔에 `Local audio captured` |
| 2 | `Mic Volume` 슬라이더를 0% → 100% 로 이동 | `updateMicVolume()` 호출 → `micGainNode.gain.value`가 실시간 변함 | 피어 카드에 **볼륨 바**(`vol-<rid>`)가 변하는지 확인 |
| 3 | `Mute/Unmute` 버튼 클릭 | `audioBtn` 텍스트가 `🎤 Mute` ↔ `🔇 Unmute` 로 토글, 트랙 `enabled` 플래그 변경 | 상대 피어가 **음소거** 상태를 감지(볼륨 바가 0% 표시) |
| 4 | **볼륨 프리셋** (`balanced`, `music`, `voice`) 선택 | 각각 지정된 마이크/시스템 볼륨이 자동 적용 (`updateMicVolume`, `updateSystemVolume`) | 토스트 메시지와 UI 슬라이더 값 확인 |

---

## 3️⃣ 시스템 오디오 캡처 & 믹싱

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | **System Audio** 버튼 클릭 → “탭 공유 + 오디오” 선택 | `systemAudioStream`이 생성되고 `mixAudioStreams()` 호출 | 콘솔에 `System audio capture started` |
| 2 | 시스템 볼륨 슬라이더 조절 | `updateSystemVolume()` 호출 → `systemGainNode.gain.value` 변동 | `systemVolBar` 가 실시간으로 변함 |
| 3 | 시스템 오디오와 마이크가 **동시** 전송 | 원격 피어에서 **두 오디오**가 합쳐진 형태로 들림 | `mixedStream` 의 `audioTrack`이 `RTCPeerConnection`에 교체됨 |
| 4 | 시스템 오디오 **중지** → `Stop System Audio` 클릭 | `systemAudioStream` 및 `mixedStream` 정리, UI 숨김 | `systemVolMeter`와 `systemVolSlider`가 사라짐 |
| 5 | **권한 거부** 테스트 (브라우저 권한 팝업에서 “거부”) | `NotAllowedError` 발생 → `showToast('시스템 오디오 공유가 거부되었습니다')` 표시 | 콘솔에 `System audio capture failed` 로그 |

---

## 4️⃣ 화면 공유 (비디오) & 화면‑오디오 충돌 방지

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | **Screen Share** 버튼 클릭 → 화면(또는 창) 선택 | `screenStream` 생성, `screenVideo` 요소에 스트림 연결 | `screenBtn` 텍스트가 `🖥️ Stop` 로 변함 |
| 2 | 화면 공유 **동시**에 시스템 오디오 공유 시도 | **오류** 발생 → `showToast('시스템 오디오를 먼저 중지해주세요')` 표시 | 화면 공유와 시스템 오디오는 **동시 사용 불가** |
| 3 | 화면 공유 시작 후 **새 피어 입장** | 새 피어가 입장하면 `createPC` 에서 `screenStream` 트랙을 자동 추가 | 새 피어의 화면 비디오가 **즉시** 표시 |
| 4 | 화면 공유 종료 (Stop 버튼 또는 탭 닫기) | `stopScreen()` 호출 → 모든 피어에게 `screen-share-stopped` 전송, UI 복구 | 콘솔에 `Screen sharing stopped` |
| 5️⃣ **비디오 최적화** – `app.js` 에서 `maxBitrate = 500000`, `priority = low` 적용 여부 확인 | 피어 카드에 표시되는 **볼륨 바**가 정상 동작하고, 오디오 지연이 최소화 | 네트워크가 느릴 때도 오디오 품질 유지 확인 |

---

## 5️⃣ 실시간 성능 모니터 (FPS / 메모리 / 통계)

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | 페이지 로드 → **Performance Monitor** 영역 확인 | `monUptime`, `monPeers`, `monAvgLat`, `monPeakLat`, `monMinLat` 가 실시간 업데이트 | `updatePerfMonitor()` 가 1초마다 호출 |
| 2 | `setInterval(updatePerfMonitor, 1000)` 가 정상 작동하는지 확인 (콘솔에 `FPS: xx` 로그) | FPS 값이 30~60 사이에 표시 (브라우저 성능에 따라) | `window.lastPerfTime` 사용 확인 |
| 3 | **메모리 사용량** (`monMem`) 표시 | `performance.memory` 지원 시 `used/total MB` 가 표시 | Chrome 전용, Edge에서도 동작 |
| 4 | **네트워크 통계** – 피어가 연결/끊길 때 `updatePeerStats` 가 호출 | 피어 카드에 `lat | jitter | loss` 형태로 표시 (예: `32ms | 2.5ms jitter | 0% loss`) | `ui.js` 에서 객체 포맷팅 적용 확인 |
| 5 | **통계 히스토리** – 60초 동안 `latencyHistory`, `bitrateHistory` 가 유지되는지 확인 | `perfData.latencyHistory.length ≤ 60` | 콘솔에 `History updated` 로그 (디버그용) |

---

## 6️⃣ 채팅 & 시스템 메시지

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | 채팅 입력 후 **Enter** → 전송 | 메시지가 `chatMessages` 리스트에 **내 메시지**와 **상대 메시지**로 표시 | `addChatMsg` 함수 호출 확인 |
| 2 | 시스템 이벤트 (예: `peer joined`, `screen-share-started`) 가 발생하면 `addSysMsg` 로 표시 | 채팅창에 *italic* 로 “UserA joined the room” 등 표시 | UI에 **시스템 메시지** 스타일 적용 |
| 3 | **채팅 자동 스크롤** – 새 메시지 도착 시 스크롤이 가장 아래로 이동 | `chatMsgs.scrollTop = chatMsgs.scrollHeight` 작동 확인 | 긴 채팅 기록에서도 정상 |

---

## 7️⃣ 메트로놈 (Metronome)

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | **Metronome** 버튼 클릭 → BPM 입력 후 시작 | 메트로놈 비프음이 설정된 BPM 으로 재생 | `startMetronome` 함수 호출 확인 |
| 2 | **Stop** 버튼 클릭 → 비프음 정지 | `stopMetronome` 호출, `metronomeInterval` 해제 | 콘솔에 `Metronome stopped` 로그 |
| 3 | **다른 피어**와 동시 사용 시 **오디오 믹싱**이 정상 (시스템 오디오와 메트로놈 모두 들림) | `mixAudioStreams` 에서 `micGainNode` 와 `systemGainNode` 가 모두 연결 | 피어 카드에 **볼륨 바**가 각각 반영 |

---

## 8️⃣ 녹음 (Recording)

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | **Record** 버튼 클릭 → 녹음 시작 | `mediaRecorder` 가 `localStream`(마이크+시스템) 로 시작 | `recordingStart` 로그 |
| 2 | 일정 시간 후 **Stop** 클릭 | `recordedChunks` 에 데이터가 저장, `download` 링크 생성 | 파일 이름 `recording-<timestamp>.webm` |
| 3 | 녹음 파일 재생 → 마이크와 시스템 오디오 모두 포함 | 녹음 파일을 로컬에서 재생했을 때 두 소리가 모두 들림 | `mixAudioStreams` 가 적용된 경우에만 확인 |

---

## 9️⃣ 보안/HTTPS 체크

| # | 테스트 단계 | 기대 결과 | 비고 |
|---|------------|----------|------|
| 1 | `http://localhost:3000` 로 접속 → **보안 경고**가 표시되지 않음 | `isSecureContext()` 반환 `true` (localhost) | `showSecurityWarning()` 은 호출되지 않음 |
| 2 | `http://192.168.x.x:3000` 로 접속 → **보안 경고** 표시 | 페이지 전체에 **HTTPS 필요** 오버레이가 뜨고, `init()` 중단 | `showSecurityWarning()` 실행 확인 |
| 3 | `https://your-domain.com` 로 배포 후 접속 → 정상 동작 | `isSecureContext()` 반환 `true` | 실제 배포 환경에서 테스트 권장 |

---

## 🔧 자동화 테스트 (Playwright / Cypress) 제안

| 테스트 | 자동화 스크립트 핵심 포인트 |
|--------|----------------------------|
| 방 입장/연결 | `page.goto`, `fill`, `click`, `waitForSelector('.peer-card')` |
| 마이크/볼륨 | `page.evaluate(() => updateMicVolume(30))`, `expect(page.locator('#vol-<rid>').first()).toHaveCSS('width', '30%')` |
| 시스템 오디오 | `page.click('#systemAudioBtn')` → `page.waitForEvent('dialog')` (권한 팝업) |
| 화면 공유 | `page.click('#screenBtn')` → `page.waitForSelector('#screenVideo')` |
| 성능 모니터 | `expect(page.locator('#monAvgLat')).toContainText(/\d+ms/)` |
| 채팅 | `page.fill('#chatInput', 'hello')`, `page.press('#chatInput', 'Enter')`, `expect(page.locator('.chat-msg')).toContainText('hello')` |
| 녹음 | `page.click('#recordBtn')`, `await page.waitForTimeout(3000)`, `page.click('#recordBtn')`, `expect(page.locator('#downloadLink')).toBeVisible()` |

> **Tip**: Playwright의 `grantPermissions(['microphone', 'display-capture'])` 로 권한을 미리 부여하면 `NotAllowedError` 를 회피할 수 있습니다.

---

## 📦 최종 체크리스트 (수동 테스트)

1. **모든 권한 허용** (마이크, 화면/시스템 오디오)  
2. **두 대 이상의 클라이언트** 로 방에 입장 → 연결 성공 확인  
3. **마이크/시스템 오디오/화면** 각각 독립·동시·중지 흐름 테스트  
4. **볼륨 슬라이더**와 **프리셋** 적용 여부 검증  
5. **성능 모니터**와 **통계 UI**가 정상 업데이트되는지 확인  
6. **채팅/시스템 메시지**가 올바르게 표시되는지 확인  
7. **메트로놈**과 **녹음** 기능이 오디오와 충돌 없이 동작하는지 검증  
8. **보안(HTTPS) 체크**가 정상 작동하는지 확인 (localhost vs. IP)  

---

### 🎉 테스트 완료 시 기대 결과

- **오디오**(마이크 + 시스템) 가 **지연 없이** 전송되고, **볼륨** 조절이 실시간 반영됨  
- **화면 공유**가 새 피어에게도 즉시 전송되고, **오디오 우선** 정책으로 합주 품질이 유지됨  
- **성능 모니터**와 **통계**가 정확히 표시되며, UI에 `[object Object]` 같은 이상한 문자열이 나타나지 않음  
- **보안 경고**가 필요 없는 환경(HTTPS/localhost)에서 정상 동작  

**행운을 빕니다!** 🎵
