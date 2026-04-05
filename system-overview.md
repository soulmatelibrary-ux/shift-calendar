# 교대근무 일정표 시스템 개요

> 한국공항공사 시스템정보부 — 단일 HTML 파일 기반 교대근무 관리 캘린더  
> 최종 업데이트: 2026-04-04 (헤더 반출/복구 아이콘, 메모 검색, 안전점검 팝업, 알림문서 발송 팝업 추가)

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [화면 구성](#2-화면-구성)
3. [데이터베이스 설계](#3-데이터베이스-설계)
4. [인증 및 세션](#4-인증-및-세션)
5. [교대조 로직](#5-교대조-로직)
6. [주요 기능](#6-주요-기능)
7. [보안 현황](#7-보안-현황)
8. [알려진 제한사항](#8-알려진-제한사항)

---

## 1. 시스템 개요

| 항목 | 내용 |
|------|------|
| 파일 | `shiftcal.html` (단일 HTML 파일) |
| 실행 환경 | Chrome / Edge (로컬 또는 GitHub Pages) |
| 백엔드 | Supabase REST API (서버 없음) |
| 인증 | Supabase Auth — JWT Password Grant |
| 배포 | Git push → GitHub Pages 자동 반영 |

### 핵심 개념
- 교대조(A/B/C/D)가 4일 주기로 순환하며 근무
- 대체근무 발생 → 대휴(DOH) 자동 부여 및 잔여 대휴 추적
- 모든 데이터는 Supabase에 저장, localStorage는 인증 토큰·UI 상태만 보관

---

## 2. 화면 구성

### 2-1. 로그인 화면 (`screen-login`)

```
┌─────────────────────────────┐
│  [로고]                      │
│  한국공항공사 시스템정보부    │
│  교대근무 일정표              │
│                              │
│  아이디 (교대 근무자)         │
│  [ a / b / c / d 입력 ]     │
│                              │
│  비밀번호                    │
│  [ ••••••• ]                │
│                              │
│  [ 로그인 ]                  │
└─────────────────────────────┘
```

| 요소 | ID | 설명 |
|------|-----|------|
| ID 입력 | `id-input` | a/b/c/d 또는 공백(관리자). 팀 필터 용도 |
| 비밀번호 입력 | `pw-input` | Supabase Auth 공용 계정 비밀번호 |
| 로그인 버튼 | `login-btn` | 클릭 시 Supabase Auth 인증 |
| 에러 메시지 | `login-error` | 인증 실패 시 표시 |

---

### 2-2. 달력 화면 (`screen-calendar`)

```
┌──────────────────────────────────────────┐
│ [↑][↺] ← 2025년 6월 →  [🌙] [로그아웃]  │  헤더
├──────────────────────────────────────────┤
│ [공지: 시스템 점검 예정 ...]              │  티커
├───┬───┬───┬───┬───┬───┬───┤
│ 일 │ 월 │ 화 │ 수 │ 목 │ 금 │ 토 │  요일 (굵게)
├───┼───┼───┼───┼───┼───┼───┤
│AB │   │DA │   │CD │   │BC │  달력 셀
│ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │
│   │연차│   │   │   │   │   │
├───┴───┴───┴───┴───┴───┴───┤
│ [🔍검색] [A조▼] [오늘] [갱신] │  하단 바
└──────────────────────────────────────────┘
```

| 요소 | 설명 |
|------|------|
| 헤더 좌측 | 반출 아이콘(`btn-json-dl2`), 복구 아이콘(`btn-json-ul2`) |
| 헤더 우측 | 월 네비게이션, 다크모드 토글, 로그아웃 |
| 티커 (`ticker-wrap`) | 공지사항 + 다가올 메모 좌우 스크롤 |
| 달력 그리드 (`cal-grid`) | 7열, 요일 헤더 굵게(font-weight:800), 셀 간격 최소화(gap:1px) |
| 하단 바 (`bottom-bar`) | 메모 검색, 조 필터, 오늘/갱신 버튼 |

**달력 셀 색상 규칙**

| 조건 | 색상 |
|------|------|
| 내 팀 근무일 | 파란 배경 |
| 다른 팀 근무일 | 흐리게 (dim-shift) |
| 오늘 | 강조 테두리 |
| 공휴일 | 빨간 날짜 |
| 주말 | 빨간 날짜 |

---

### 2-3. 상세 시트 (슬라이드업)

날짜 셀 클릭 시 하단에서 슬라이드업되는 패널.

```
┌─────────────────────────────┐
│ 2025년 6월 15일 (일)        │
├─────────────────────────────┤
│ 교대조: [AB] [DA] [CD] [BC] │
│         또는 직접 입력       │
├─────────────────────────────┤
│ 연차:김철수    [×]          │
│ 대체:이영희    [×]          │
├─────────────────────────────┤
│ [＋ 일정 추가]              │
│ → 추가 폼 펼침              │
│   타입: 메모/연차/대체/대휴 … │
│   [연차+대체 원클릭]        │
└─────────────────────────────┘
```

---

### 2-4. 모달 목록

| 모달 | 용도 |
|------|------|
| 공지사항 관리 (`notice-modal`) | 공지 추가/수정/삭제 |
| 변경사항 (`changes-modal`) | 마지막 동기화 이후 변경 내역 |
| 삭제 확인 (`del-modal`) | 반복 일정 삭제 — 현재만 / 이후 전체 |
| 메모 검색 (`search-overlay`) | 전 기간 메모 키워드 검색, 결과 클릭 시 해당 월 이동 |
| 공통 알림 모달 (`shared-alert-modal-wrap`) | 안전점검·알림문서 발송 팝업 — 큐 방식으로 순차 표시 |

---

## 3. 데이터베이스 설계

### 3-1. shift_data — 교대조 및 일정 메모

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `date` | TEXT (PK) | 날짜 `YYYY-MM-DD` |
| `shift` | TEXT | 교대조 코드 (`AB`, `DA`, `CD`, `BC`, `AA`) |
| `memo` | TEXT[] | 메모 배열 (`["연차:김철수", "대체:이영희"]`) |
| `repeat_type` | TEXT | 반복 타입 (`weekly`, `monthly`, null) |
| `source` | TEXT | 저장 출처 (`mobile`, `desktop`, `restore`) |
| `updated_at` | TIMESTAMP | 마지막 수정 시각 |

**메모 형식 규칙**

| 타입 | 형식 | 예시 | 색상 |
|------|------|------|------|
| 메모 | 자유 텍스트 | `오늘 회의` | 초록 |
| 연차 | `연차:이름` | `연차:김철수` | 빨강 |
| 대체 | `대체:이름` | `대체:이영희` | 파랑 |
| 대휴 | `대휴:이름(YY-MM-DD)` | `대휴:김철수(25-06-15)` | 빨강 |
| 교육 | `교육:내용(참조)` | `교육:신입교육(2025-06)` | 빨강 |
| 출장 | `출장:내용(참조)` | `출장:서울(3일)` | 파랑 |
| 기타 | `기타:내용(참조)` | `기타:병가` | 회색 |
| **알림** | `알림:내용` | `알림:팀 회의 준비` | 노랑 🔔 |

---

### 3-2. staff_master — 직원 마스터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT (PK) | 자동 증가 |
| `name` | TEXT | 직원명 |
| `grade` | TEXT | 직급 (`차장`, `현장일근` 등) |
| `shift` | TEXT | 소속 (`A`, `B`, `C`, `D`, `비교대` 등) |
| `from_date` | DATE | 근무 시작일 |
| `to_date` | DATE | 근무 종료일 (null = 현재 재직) |

- 전보일 입력 시 `to_date`는 **전날**로 저장
- 교대근무자 판별: `shift` 값이 `/^[A-D](조)?$/` 에 매칭

---

### 3-3. notices — 공지사항

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT (PK) | 자동 증가 |
| `text` | TEXT | 공지 내용 |
| `start_date` | DATE | 공지 시작일 (null = 상시) |
| `end_date` | DATE | 공지 종료일 (null = 상시) |
| `deleted_at` | TIMESTAMP | Soft-delete 시각 (null = 활성) |
| `created_at` | TIMESTAMP | 생성 시각 |

- 삭제는 물리 삭제가 아닌 `deleted_at` 업데이트 (Soft-delete)
- 조회 시 `deleted_at=is.null` 필터 적용

---

### 3-4. carry_over — 이월 대휴시간

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `year` | INT | 연도 |
| `name` | TEXT | 직원명 |
| `hours` | INT | 이월 대휴시간 |

---

### 3-5. app_config — 앱 설정

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `key` | TEXT (PK) | 설정 키 |
| `value` | TEXT | 설정 값 |

> **현재 사용**: 비밀번호는 Supabase Auth로 이전 완료. `app_password` 키는 더 이상 사용하지 않음.

---

### 3-6. RLS (Row Level Security) 정책

| 테이블 | 역할 | 허용 작업 |
|--------|------|-----------|
| `shift_data` | authenticated | ALL (SELECT, INSERT, UPDATE, DELETE) |
| `staff_master` | authenticated | ALL |
| `notices` | authenticated | ALL |
| `carry_over` | authenticated | ALL |
| `app_config` | authenticated | SELECT only |

> anon 역할은 모든 테이블에 접근 불가. 반드시 Supabase Auth 인증 후 JWT 토큰이 있어야 데이터 접근 가능.

---

### 3-7. localStorage 키

| 키 | 상수명 | 용도 |
|----|--------|------|
| `sc_token` | `TOKEN_KEY` | Supabase Auth JWT 액세스 토큰 |
| `sc_auth` | `AUTH_KEY` | 로그인 교대 ID (`a`/`b`/`c`/`d`/`all`) |
| `sc_refresh` | `REFRESH_KEY` | Supabase Auth refresh token |
| `sc_last_sync` | `SYNC_KEY` | 마지막 데이터 동기화 시각 (ISO) |
| `sc_dark` | — | 다크모드 설정 (`0`/`1`) |
| `sc_memo_alert_YYYY-MM-DD` | — | 알림 메모 팝업 표시 여부 (당일) |
| `sc_safety_YYYY-MM-DD` | — | 안전점검 알림 표시 여부 (당일, 비교대 전용) |
| `sc_basever_YYYY-MM-DD` | — | 알림문서 발송 팝업 표시 여부 (당일, 전체) |

---

## 4. 인증 및 세션

### 4-1. 공용 계정 구조

모든 사용자는 하나의 Supabase Auth 계정을 공유합니다.

| 항목 | 값 |
|------|-----|
| 이메일 | `starred3@naver.com` |
| 비밀번호 | 앱 공용 비밀번호 (Supabase Auth에 설정) |
| ID 입력 (`a`/`b`/`c`/`d`) | 팀 필터 용도만 — 인증과 무관 |

### 4-2. 로그인 흐름

```
1. 사용자 입력 (ID + 비밀번호)
        ↓
2. ID 유효성 검증 (a/b/c/d 또는 공백)
        ↓
3. POST /auth/v1/token
   { email: "starred3@naver.com", password: "입력한 비밀번호" }
        ↓
4. Supabase → JWT access_token 발급
        ↓
5. localStorage 저장
   sc_token = access_token
   sc_auth  = id || "all"
        ↓
6. 달력 화면 진입 + 데이터 로드
```

### 4-3. API 요청 헤더

```javascript
function getH() {
  return {
    'apikey': SB_KEY,                              // 프로젝트 식별용 anon 키
    'Authorization': 'Bearer ' + _accessToken,    // JWT 인증 토큰
    'Content-Type': 'application/json'
  };
}
```

- `_accessToken` 없으면 `SB_KEY`로 폴백 → RLS에 의해 접근 차단됨

### 4-4. 로그아웃

```javascript
function doLogout() {
  localStorage.removeItem(AUTH_KEY);   // sc_auth 삭제
  localStorage.removeItem(TOKEN_KEY);  // sc_token 삭제
  _accessToken = null;
  showScreen('login');
}
```

> Supabase 서버 측 세션 무효화(`/auth/v1/logout`) 미호출 — 토큰 만료(기본 1시간)까지 기술적으로 유효

---

## 5. 교대조 로직

### 5-1. 교대조 순환

| 상수 | 값 |
|------|-----|
| `BASE_DATE` | `2025-06-02` (기준일, AB조) |
| `SHIFTS` | `['AB', 'DA', 'CD', 'BC']` |
| 주기 | 4일 |

**순환 계산:**
```javascript
function calcShift(dateStr) {
  const diff = Math.floor((new Date(dateStr) - BASE_DATE) / 86400000);
  return SHIFTS[((diff % 4) + 4) % 4];
}
```

| 날짜 | 교대조 | 야간팀 |
|------|--------|--------|
| 2025-06-02 | AB | B |
| 2025-06-03 | DA | A |
| 2025-06-04 | CD | D |
| 2025-06-05 | BC | C |
| 2025-06-06 | AB | B (반복) |

- 교대조 2번째 문자가 야간팀 (`AB` → B조 야간)

### 5-2. 팀 매핑

```javascript
const SHIFT_MAP = { a:'A', b:'B', c:'C', d:'D' };
```

| 로그인 ID | 팀 | 필터 |
|-----------|-----|------|
| `a` | A조 | A조 근무일 강조 |
| `b` | B조 | B조 근무일 강조 |
| `c` | C조 | C조 근무일 강조 |
| `d` | D조 | D조 근무일 강조 |
| 공백 | — | 전체 보기 |

### 5-3. 대휴(DOH) 계산 기준

| 대체 근무 조건 | 보상 시간 |
|---------------|----------|
| 주말 (토/일) | 8시간 |
| 주중 + 교대근무일 | 11시간 |
| 주중 + 일근 야간 | 16.5시간 *(코드 미구현)* |
| 평일 일근 | 0시간 |

---

## 6. 주요 기능

### 6-1. 일정 메모 CRUD

| 기능 | 함수 | 설명 |
|------|------|------|
| 저장 | `onSaveMemo()` | 단일/기간/반복(주간·월간) 지원 |
| 삭제 | `onDelMemo()` | 반복 일정은 현재만 또는 이후 전체 선택 |
| 쓰기 | `writeMemo()` | row 있으면 PATCH, 없으면 POST |

### 6-2. 연차+대체 원클릭

1. 버튼 클릭 → 기본값 자동 설정 (야간팀 직원, 일근자)
2. 확인 폼 표시 (사용자가 수정 가능)
3. 저장 시:
   - 현재 날짜에 `연차:이름`, `대체:이름` 추가
   - 지정 날짜에 `대휴:이름(날짜)` 크로스 저장

### 6-3. 데이터 백업/복구

| 기능 | 설명 |
|------|------|
| 반출 (Export) | 현재달~미래 데이터를 JSON 파일로 다운로드 |
| 복구 (Import) | JSON 파일 업로드 → 기존 데이터 삭제 후 삽입 (100건씩 배치, 실패 시 롤백) |

### 6-4. 변경사항 감지

- 앱 진입 시 `sc_last_sync` 이후 변경된 row를 조회
- 변경 내역이 있으면 모달로 알림

### 6-5. 공지사항 관리

- 기간 지정 가능 (`start_date` ~ `end_date`)
- 삭제는 Soft-delete (`deleted_at` 기록)
- 티커에 스크롤 표시

### 6-6. 메모 검색

- 하단 바 [🔍검색] 버튼으로 `search-overlay` 패널 열기
- `_yearData` + `_monthData` 전 기간 메모를 키워드로 검색
- 결과에 `<mark>` 하이라이트, 날짜 클릭 시 해당 월로 이동 후 패널 닫힘
- XSS 방지: `escH(line).replace(escapedHtmlKw_re, '<mark>$1</mark>')` 패턴 사용

### 6-7. 알림 메모 팝업

- 메모 타입 `알림:`을 shift_data.memo에 저장 (별도 테이블 없음)
- 달력 셀에 🔔 아이콘 표시
- 상세 시트 상단에 노란 배너로 강조
- 앱 접속 시 **당일/전일** 알림 메모가 있으면 팝업 모달 자동 표시
- 하루 1회만 표시 (localStorage `sc_memo_alert_YYYY-MM-DD` 기록)
- 모든 조 공유

### 6-8. 자동 팝업 알림

앱 진입(`initApp`) 및 수동 갱신(`btn-refresh`) 시 `checkSafetyAlert()`, `checkBaseVersionAlert()` 순차 호출.  
모달이 동시에 여러 개 열릴 수 있는 경우를 `_alertQueue` 큐로 처리해 순차 표시.

| 알림 종류 | 함수 | 트리거 조건 | 대상 | localStorage 키 |
|-----------|------|------------|------|-----------------|
| 안전점검 알림 | `checkSafetyAlert()` | 매월 4/14/24일 당일 또는 3/13/23일(전날) | `SHIFT_MAP[_authId]`가 없는 비교대 직원 | `sc_safety_YYYY-MM-DD` |
| 알림문서 발송 | `checkBaseVersionAlert()` | `베이스버전 설치` / `베이스 설치` / `적응자료 설치` 메모 등록일 기준 +13/+14일 | 전체 로그인 사용자 | `sc_basever_YYYY-MM-DD` |

**공통 구현 패턴**
- `ALERT_THEMES` 객체로 라이트/다크 모드 색상 중앙 관리 (`safety`: 노란계열, `doc`: 파란계열)
- `pruneAlertKeys(prefix)` — 30일 초과 localStorage 키 자동 정리
- 하루 1회만 표시 (날짜 키로 dedup)
- `showAlertModal({ icon, heading, title, sub, theme })` — 공통 모달 생성 함수

---

## 7. 보안 현황

### 7-1. 인증 보안

| 항목 | 현황 |
|------|------|
| 인증 방식 | Supabase Auth JWT (Password Grant) |
| RLS | 전 테이블 `authenticated` 역할 전용 — anon 완전 차단 |
| 비밀번호 저장 | Supabase Auth 내부 (bcrypt 해싱) |
| 토큰 저장 | localStorage 평문 저장 |
| 토큰 갱신 | **구현됨** — refresh_token으로 자동 갱신, 실패 시 로그인 화면 |
| 서버 측 로그아웃 | **미구현** — 토큰 만료까지 기술적 유효 |

### 7-2. XSS 방지

모든 사용자 입력 및 DB 데이터를 `innerHTML`에 삽입 시 이스케이프 함수 적용:

```javascript
escH(s)  // HTML 텍스트 컨텍스트 — &, <, >, " 이스케이프
escA(s)  // HTML 속성 컨텍스트 — &, ", ' 이스케이프
```

적용 부분: 공지 텍스트, 공지 날짜, 직원명, 메모 텍스트, 교대조 표시 등

### 7-3. Content Security Policy

```
default-src 'self'
script-src  'self' 'unsafe-inline'    ← 인라인 JS로 인해 불가피
style-src   'self' 'unsafe-inline'    ← 인라인 CSS로 인해 불가피
connect-src 'self' https://zonighcdnzdmsleltdmr.supabase.co
img-src     'self' data:
```

### 7-4. 입력 검증

| 검증 항목 | 방식 |
|-----------|------|
| 로그인 ID | `a`/`b`/`c`/`d` 또는 공백만 허용 |
| 날짜 형식 | `/^\d{4}-\d{2}-\d{2}$/` 정규식 |
| 교대조 형식 | `/^[A-Z]{1,4}$/` 정규식 |
| 메모 길이 | 200자 제한 |
| JSON 복구 데이터 | 날짜 형식 및 필드 검증 |

### 7-5. 기타

- 네트워크 타임아웃: 12초 (`AbortController`)
- API 오류 시 서버 응답 본문이 toast에 노출될 수 있음 (개선 권장)

---

## 8. 알려진 제한사항

| 항목 | 내용 | 영향도 |
|------|------|--------|
| JWT 토큰 자동 갱신 | refresh_token으로 자동 갱신 구현됨 | 해결 |
| 연도 전환 시 연간 데이터 미갱신 | 12월→1월 이동 시 DOH 이전 연도 기준 | 중간 |
| 일근 야간 16.5h 미구현 | 비교대 평일 야간 대체 보상 0h 계산 | 중간 |
| 오늘 날짜 페이지 로드 시 고정 | 오래 열어두면 날짜 강조 오류 | 낮음 |
| 반복 일정 일괄 삭제 N+1 호출 | 건수 많을 시 느림 | 낮음 |
| 서버 측 로그아웃 없음 | 토큰 탈취 시 만료 전까지 유효 | 낮음 |

---

## 부록: 주요 상수

| 상수 | 값 | 용도 |
|------|-----|------|
| `SB_URL` | `https://zonighcdnzdmsleltdmr.supabase.co` | Supabase 프로젝트 URL |
| `SB_KEY` | `sb_publishable_...` | anon 공개 키 |
| `SB_AUTH_EMAIL` | `atob(...)` (base64 인코딩) | 공용 로그인 이메일 |
| `BASE_DATE` | `2025-06-02` | 교대조 계산 기준일 |
| `SHIFTS` | `['AB','DA','CD','BC']` | 교대조 순환 배열 |
| `SHIFT_MAP` | `{a:'A', b:'B', c:'C', d:'D'}` | 로그인 ID → 팀 매핑 |
| `AUTH_KEY` | `sc_auth` | localStorage 인증 키 |
| `TOKEN_KEY` | `sc_token` | localStorage JWT 키 |
| `SYNC_KEY` | `sc_last_sync` | localStorage 동기화 키 |
