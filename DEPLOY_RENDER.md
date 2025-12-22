# 🚀 Render 배포 가이드

## 목차
1. [사전 준비](#1-사전-준비)
2. [프로젝트 설정](#2-프로젝트-설정)
3. [Render 설정](#3-render-설정)
4. [배포](#4-배포)
5. [HTTPS/WSS 설정](#5-httpswss-설정)
6. [환경 변수](#6-환경-변수)
7. [커스텀 도메인](#7-커스텀-도메인)
8. [모니터링](#8-모니터링)
9. [문제 해결](#9-문제-해결)

---

## 1. 사전 준비

### 필요한 것
- [Render 계정](https://render.com) (무료)
- [GitHub 계정](https://github.com)
- 프로젝트 코드

### Render 무료 티어
| 항목 | 제한 |
|------|------|
| 웹 서비스 | 무제한 |
| 실행 시간 | 750시간/월 |
| 비활성 후 슬립 | 15분 |
| 메모리 | 512MB |
| CPU | 0.1 vCPU |

> ⚠️ 무료 티어는 15분 비활성 후 슬립됩니다. 첫 요청 시 30초~1분 대기 필요.

---

## 2. 프로젝트 설정

### 2.1 package.json 확인

`package.json`에 다음이 있는지 확인:

```json
{
  "name": "webrtc-mesh-test",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.14.2"
  }
}
```

### 2.2 GitHub에 푸시

```bash
# Git 초기화 (처음인 경우)
git init

# .gitignore 생성
echo "node_modules/" > .gitignore

# 커밋
git add .
git commit -m "Initial commit"

# GitHub 리포지토리 생성 후
git remote add origin https://github.com/YOUR_USERNAME/webrtc-mesh-test.git
git branch -M main
git push -u origin main
```

---

## 3. Render 설정

### 3.1 Render 가입/로그인

1. [render.com](https://render.com) 접속
2. **Get Started** 클릭
3. **GitHub로 가입** 권장

### 3.2 새 웹 서비스 생성

1. 대시보드에서 **New +** 클릭
2. **Web Service** 선택
3. **Connect a repository** 선택
4. GitHub 계정 연결 (처음인 경우)
5. `webrtc-mesh-test` 저장소 선택

### 3.3 서비스 설정

| 항목 | 값 |
|------|------|
| **Name** | `webrtc-mesh` (원하는 이름) |
| **Region** | `Singapore` (한국에서 가장 가까움) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Instance Type** | `Free` |

### 3.4 환경 변수 설정

**Environment Variables** 섹션에서:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | (비워두기 - Render가 자동 설정) |

---

## 4. 배포

### 4.1 배포 시작

1. 설정 완료 후 **Create Web Service** 클릭
2. 자동으로 빌드 및 배포 시작
3. 로그에서 진행 상황 확인

### 4.2 배포 완료 확인

```
==> Build started
==> Cloning from GitHub...
==> Installing dependencies with npm...
==> Build completed
==> Deploying...
==> Your service is live 🎉
```

### 4.3 서비스 URL

배포 완료 후 URL 제공:
```
https://webrtc-mesh.onrender.com
```

---

## 5. HTTPS/WSS 설정

### Render 자동 HTTPS

✅ Render는 자동으로 HTTPS를 제공합니다!

- HTTP → HTTPS 자동 리다이렉트
- 무료 SSL 인증서 (Let's Encrypt)
- WebSocket도 자동으로 WSS

### 클라이언트 코드 수정 불필요

`app.js`의 WebSocket URL이 다음과 같으면 자동으로 작동:

```javascript
const WS_URL = `ws://${location.host}`;
```

브라우저가 HTTPS 페이지에서 자동으로 WSS로 연결합니다.

### 명시적 WSS 사용 (선택)

더 명확하게 하려면:

```javascript
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${location.host}`;
```

---

## 6. 환경 변수

### Render 대시보드에서 설정

1. 서비스 선택
2. **Environment** 탭
3. **Add Environment Variable**

### 권장 환경 변수

| Key | Value | 설명 |
|-----|-------|------|
| `NODE_ENV` | `production` | 프로덕션 모드 |
| `USE_CLUSTER` | `false` | Render Free는 단일 프로세스 권장 |

> ⚠️ Render Free 티어에서는 클러스터 모드를 사용하지 않는 것이 좋습니다 (메모리 제한).

---

## 7. 커스텀 도메인

### 7.1 도메인 추가

1. 서비스 선택
2. **Settings** 탭
3. **Custom Domains** 섹션
4. **Add Custom Domain** 클릭
5. 도메인 입력 (예: `webrtc.yourdomain.com`)

### 7.2 DNS 설정

Render가 제공하는 CNAME 레코드를 DNS에 추가:

| Type | Name | Value |
|------|------|-------|
| CNAME | webrtc | webrtc-mesh.onrender.com |

### 7.3 SSL 인증서

✅ 커스텀 도메인도 자동 SSL 발급

---

## 8. 모니터링

### Render 대시보드

- **Logs**: 실시간 로그 확인
- **Metrics**: CPU, 메모리 사용량
- **Events**: 배포 이력

### 로그 확인

```bash
# 대시보드에서
서비스 선택 → Logs 탭
```

### 상태 확인

```bash
# 브라우저에서
https://webrtc-mesh.onrender.com/api/rooms
```

---

## 9. 문제 해결

### 서비스가 슬립 상태

**원인**: 15분 비활성으로 슬립

**해결**:
- 첫 요청 시 30초~1분 대기
- 유료 플랜 업그레이드 (Always On)
- 외부 서비스로 주기적 ping

### WebSocket 연결 실패

**원인**: WSS 미사용

**확인**:
```javascript
// 브라우저 콘솔에서
console.log(location.protocol); // https:
```

**해결**:
```javascript
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${location.host}`;
```

### 빌드 실패

**확인**:
1. `package.json` 문법 오류
2. `node_modules` 가 `.gitignore`에 있는지
3. 의존성 버전 호환성

### 메모리 초과

**원인**: Free 티어 512MB 제한

**해결**:
- 연결 수 제한
- 채팅 기록 제한
- 유료 플랜 업그레이드

---

## 자동 배포

### GitHub 연동

Render는 GitHub와 자동 연동:

1. `main` 브랜치에 푸시
2. 자동으로 재배포

### 배포 트리거

```bash
git add .
git commit -m "Update feature"
git push origin main
# → Render 자동 배포 시작
```

---

## 요금제 비교

| 플랜 | 가격 | 메모리 | CPU | 슬립 |
|------|------|--------|-----|------|
| **Free** | $0 | 512MB | 0.1 | 15분 후 |
| **Starter** | $7/월 | 512MB | 0.5 | 없음 |
| **Standard** | $25/월 | 2GB | 1 | 없음 |

### 권장

- **테스트/데모**: Free
- **소규모 프로덕션**: Starter ($7/월)
- **프로덕션**: Standard ($25/월)

---

## 빠른 배포 체크리스트

- [ ] `package.json` 확인
- [ ] GitHub 리포지토리 생성
- [ ] 코드 푸시
- [ ] Render 계정 생성
- [ ] GitHub 연결
- [ ] 웹 서비스 생성
- [ ] 환경 변수 설정
- [ ] 배포 확인
- [ ] 테스트

---

## 배포 후 테스트

1. **브라우저에서 접속**
   ```
   https://webrtc-mesh.onrender.com
   ```

2. **방 생성 테스트**
   - Room ID 입력
   - Create 클릭
   - 마이크 권한 허용

3. **다른 기기에서 참여**
   - 같은 URL 접속
   - 같은 Room ID로 Join

4. **WebSocket 확인**
   - 브라우저 개발자 도구 → Network → WS
   - 연결 상태 확인

---

*배포 완료 후 문제가 있으면 언제든 물어보세요!*
