# NaverWishAlertBot

Naver Shopping 위시리스트 상품의 가격 변동 및 재입고를 감지하여 알림을 발생시키는 봇입니다.
WebTrafficBot 구조 기반으로 제작되었습니다.

## 프로젝트 구조

```
NaverWishAlertBot/
├── index.js            - 진입점. 프로필별 Chrome 실행 및 봇 순차 실행
├── main.js             - 오케스트레이터. navigate 단계 조합 실행
├── seedConfig.js       - bot_config DB 초기 설정 주입
├── run.bat             - Windows 실행 단축 스크립트
├── package.json
├── data/               - SQLite DB 파일 저장 위치 (wish_alert.db)
├── db/
│   └── index.js        - DB 초기화 및 CRUD 헬퍼
├── navigates/
│   ├── navigate1OpenWishlist.js      - 위시리스트 페이지 열기 & 로그인 확인
│   ├── navigate2ScanWishItems.js     - 아이템 목록 스캔 & DB 저장
│   ├── navigate3CheckPriceChange.js  - 각 아이템 가격/재고 체크 & 변동 감지
│   ├── navigate4Alert.js             - 알림 발생 (콘솔 + DB 기록)
│   └── utils/
│       └── index.js    - 공통 유틸 (sleep, scroll, logger 등)
└── scripts/            - 로컬 빌드/정리/업로드 유틸
```

## DB 테이블

| 테이블 | 설명 |
|--------|------|
| `bot_config` | 프로필별 설정 (위시리스트 URL, 알림 임계값 등) |
| `wish_items` | 위시리스트 아이템 목록 |
| `price_history` | 가격/재고 체크 이력 |
| `alert_log` | 발생된 알림 이력 |
| `run_history` | 봇 실행 이력 |
| `account_status` | 계정 차단 상태 |

## 사용법

### 1. 의존성 설치
```
npm install
```

### 2. 설정 주입
`seedConfig.js` 의 상수값 수정 후:
```
node seedConfig.js
```

### 3. 봇 실행
```
node index.js
# 또는
run.bat
```

### 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `NAVER_ID` | 특정 프로필 하나만 실행 | 미지정 시 전체 |
| `NAVER_LOGIN_ID` | 네이버 자동 로그인 아이디 | - |
| `NAVER_LOGIN_PASSWORD` | 네이버 자동 로그인 비밀번호 | - |
| `BOT_NAVIGATE` | 실행할 navigate 단계 (1/2/3/4/all) | `all` |
| `BOT_DEBUG` | 디버그 로그 출력 (`1`) | - |

`NAVER_LOGIN_PASSWORD` 에 `#` 문자가 들어가면 `.env` 파일에서 주석으로 해석될 수 있으므로 큰따옴표로 감싸서 작성하세요.

## navigate 단계 설명

| 단계 | 파일 | 역할 |
|------|------|------|
| 1 | navigate1OpenWishlist | 위시리스트 페이지 열기 & 로그인 상태 확인 |
| 2 | navigate2ScanWishItems | 아이템 전체 스캔 & DB upsert |
| 3 | navigate3CheckPriceChange | 아이템별 현재 가격/품절 체크, 변동 감지 |
| 4 | navigate4Alert | 변동 아이템에 대한 알림 출력 및 DB 기록 |
