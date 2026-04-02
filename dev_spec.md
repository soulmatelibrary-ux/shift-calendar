# 교대근무 일정표 — Supabase 연동 개발 설계서

작성일: 2026-04-02  
작성자: 시스템정보부

---

## 1. 프로젝트 개요

### 목적
폐쇄망 전용 `shiftCalendar.html`의 일정 데이터를 인터넷망에서도 조회·입력할 수 있도록
Supabase를 중간 저장소로 사용하는 양방향 동기화 시스템 구축.
iPhone 홈화면 추가(PWA)로 앱처럼 사용 가능한 모바일 웹앱 제공.

### 배포 환경
- 모바일 앱 파일: GitHub Pages (HTTPS 자동 제공, 무료)
- 데이터베이스: Supabase (PostgreSQL + REST API)
- 폐쇄망 파일: 로컬 PC (변경 없음, Supabase 동기화 기능만 추가)

---

## 2. 파일 구성

| 파일 | 용도 | 실행 환경 |
|------|------|-----------|
| `shiftCalendar.html` | 폐쇄망 메인 앱 (기존) + ☁ 동기화 버튼 추가 | 로컬 Chrome/Edge |
| `shiftcal.html` | 인터넷망 모바일/PC 반응형 앱 (신규) | GitHub Pages → iPhone/PC 브라우저 |
| `manifest.json` | PWA 홈화면 추가 설정 | GitHub Pages |
| `sw.js` | Service Worker (오프라인 캐시) | GitHub Pages |
| `supabase_setup.sql` | DB 초기 설정 SQL (기존) | Supabase SQL Editor |

---

## 3. 시스템 아키텍처

```
폐쇄망 PC
  shiftCalendar.html
  ├── [☁ 업로드] → Supabase DB (source='desktop')
  └── [↓ 병합]  ← Supabase DB (source='mobile' & updated_at > lastSyncAt)

인터넷망
  GitHub Pages
  └── shiftCalendar_mobile.html
        ↕ REST API (anon key + RLS)
        Supabase DB
```

---

## 4. Supabase 설정

### 접속 정보
- URL: Supabase 프로젝트 URL (Settings > API)
- Anon Key: Supabase Publishable Key (Settings > API)
- 초기 비밀번호: app_config 테이블에서 관리

### 테이블 구조

#### shift_data (핵심 데이터)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| date | DATE PK | 날짜 (YYYY-MM-DD) |
| shift | TEXT | 교대조 (AA/BB 등 수동 변경값, NULL이면 자동계산) |
| memo | TEXT[] | 메모 배열 |
| repeat_type | TEXT | 반복 유형 |
| source | TEXT | 마지막 수정 출처 ('desktop' / 'mobile') |
| updated_at | TIMESTAMPTZ | 마지막 수정 시각 (trigger 자동갱신) |

#### notices, carry_over, staff_master, app_config
→ `supabase_setup.sql` 참조

### RLS 정책
anon 키로 전체 접근 허용 (팀 내부 도구, 비밀번호는 앱 레벨에서 관리)

---

## 5. 인증 방식

### 로그인 설계

| 구분 | ID | 기본 뷰 |
|------|-----|---------|
| A조 근무자 | `a` | A조 필터 달력 |
| B조 근무자 | `b` | B조 필터 달력 |
| C조 근무자 | `c` | C조 필터 달력 |
| D조 근무자 | `d` | D조 필터 달력 |
| 교대 외 직원 | (빈칸) | 전체 달력 |

> 비밀번호는 Supabase app_config 테이블에서 관리합니다.

### 로그인 폼
- **ID 필드**: 선택 입력 (a/b/c/d 중 하나, 또는 빈칸)
- **비밀번호 필드**: 필수 (팀 공용 비밀번호)
- ID가 a/b/c/d이면 해당 조 필터 보기로 진입
- ID가 빈칸이거나 a/b/c/d가 아니면 전체보기로 진입

### 달력 뷰 필터
- 조별 필터(A/B/C/D): 해당 조 근무일 강조, 다른 조 메모 흐리게
- **"전체 달력 보기"** 버튼: 필터 해제하고 전체보기로 전환
- 뷰 상태 sessionStorage에 저장

### app_config 테이블
```
key='app_password', value='[팀 공용 비밀번호]'
```

### 검증 로직
```javascript
// app_config에서 비밀번호 조회 후 비교 (클라이언트 사이드)
// ID 'a'~'d' → 해당 조 필터 / 나머지 → 전체 뷰
```

### 로그인 지속성
- `localStorage`에 인증 상태 저장 → **앱을 닫았다 다시 열어도 자동 로그인**
- 저장 키: `sc_auth` (값: 'a'/'b'/'c'/'d'/'all')
- 로그아웃 버튼으로만 해제 가능

> 주의: 비밀번호 자체는 네트워크 평문 전송. 팀 내부 도구이므로 허용.

---

## 6. shiftcal.html 상세 설계

### 6.1 화면 구성 (SPA)

```
[로그인 화면]
  비밀번호 입력 → app_config 조회 → 검증 → 달력 이동

[달력 화면]
  헤더: 이전달 | YYYY년 M월 | 다음달 | 오늘 | 새로고침 | 로그아웃
  공지 배너: 활성 공지사항 (최대 3개)
  잔여대휴 바: 직원별 잔여 대휴 (이월+발생-사용)
  요일 행: 일 월 화 수 목 금 토
  달력 그리드: 7열, 날짜 클릭 → 상세 시트 열기

[날짜 상세 시트]
  모바일: bottom sheet (스와이프 다운으로 닫기)
  PC: 중앙 모달 (max-width 480px)
  
  내용:
    - 교대조 뱃지
    - 기존 메모 목록 (항목별 삭제 버튼)
    - [+ 일정 추가] 폼 (접기/펼치기)
      타입: 메모 | 연차 | 대체 | 대휴
      저장 → Supabase PATCH/INSERT
```

### 6.2 달력 셀 표시 항목

| 항목 | 표시 방식 |
|------|-----------|
| 날짜 번호 | 중앙 상단 (오늘: 파란 원) |
| 교대조 뱃지 | 날짜 아래 소형 뱃지 |
| 메모 점(dot) | 하단 중앙 파란 점 (메모 있을 때) |
| 일요일 | 빨간 글씨 |
| 토요일 | 파란 글씨 |
| 공휴일 | 빨간 글씨 |
| 오늘 | 파란 배경 |

### 6.3 반응형 레이아웃

| 구분 | 기준 | 설계 |
|------|------|------|
| 모바일 | ≤ 599px | full-width, bottom sheet, 터치 타깃 min 48px |
| PC | ≥ 600px | max-width 800px 중앙 정렬, centered modal |

### 6.4 터치 UX 규칙
- 버튼 최소 높이: 48px
- 터치 타깃 최소: 44×44px
- bottom sheet 스와이프 다운 100px 이상 → 닫기
- 달력 셀 최소 높이: 72px
- 텍스트 최소 크기: 13px (zoom 방지)

### 6.5 PWA 설정
```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="교대일정">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#2563eb">
```

---

## 7. 데이터 로딩 전략

### 달력 뷰
- 현재 월 ± 그리드 빈칸 범위의 `shift_data` 로드
- `staff_master` (현재 재직자) 로드
- `notices` (활성 공지) 로드

### 잔여대휴 계산
- 현재 연도 전체 `shift_data` (with memos) 별도 로드
- `carry_over` 현재 연도 로드
- 계산: 이월 + 대체 발생 - 대휴 사용

### 캐싱
- 월 이동 시 해당 월 재로드
- 새로고침 버튼으로 수동 갱신
- Service Worker: 정적 파일 Cache-First, Supabase API Network-First

---

## 8. 메모 저장 형식

모바일에서 저장 시 기존 `shiftCalendar.html`과 동일한 포맷 사용:

| 타입 | 저장 형식 예시 |
|------|---------------|
| 메모 | `공지사항입니다` |
| 연차 | `연차:홍길동` |
| 대체 | `대체:홍길동` |
| 대휴 | `대휴:홍길동` 또는 `대휴:홍길동(2026-03-15)` |

---

## 9. Supabase 쓰기 전략

### 모바일 → Supabase

기존 행이 있으면 `memo`, `source`, `updated_at`만 PATCH (shift 값 보존):
```
PATCH /rest/v1/shift_data?date=eq.{date}
{ "memo": [...], "source": "mobile", "updated_at": "..." }
```

신규 행이면 INSERT:
```
POST /rest/v1/shift_data
{ "date": "...", "shift": null, "memo": [...], "source": "mobile" }
```

### 폐쇄망 → Supabase (업로드)
전체 `shift_data` UPSERT (source='desktop')
`notices`, `carry_over`, `staff_master` UPSERT

### 동기화 공통 규칙
- **충돌 해결**:
  - shift: 로컬(desktop) 값 우선
  - memo: 합집합 (중복 제거, 순서 보존)

### 업로드 (폐쇄망 → Supabase)
- 범위: **전체 JSON** 데이터 업로드 (날짜 제한 없음)
- Supabase에 전체 shift_data, notices, carry_over, staff_master UPSERT
- source='desktop'
- 언제든 JSON 파일을 복사해서 다시 올려도 문제없음 (멱등성 보장)

```
모든 local shift_data → Supabase UPSERT (source='desktop')
```

### 병합 (Supabase → 폐쇄망)
- 범위: **현재 달 이후** 데이터만 가져옴 (과거 달 스킵)
- source='mobile' 인 행만 대상

```
remoteRows = fetch Supabase where date >= 이번달1일 AND source='mobile'
for each remote row:
  local = localStorage[date]
  merged_memo = union(local.memo, remote.memo)  // 중복제거
  merged_shift = local.shift || remote.shift    // 로컬 우선
  update localStorage[date]
save → autoSave()
```

### 모바일 → Supabase 저장
- 범위: **현재 달 이후** 날짜만 저장 허용 (과거 날짜 편집 불가)
- 과거 달 날짜: 달력 조회만 가능 (메모 추가/삭제 비활성화)
- source='mobile'

```
if date < 이번달1일 → 편집 불가 (읽기 전용)
else → PATCH memo (shift 보존), source='mobile'
```

---

## 10. shiftCalendar.html 추가 기능 설계

### 사이드바 추가 섹션 (기존 "저장/불러오기" 아래)

```
── 클라우드 동기화 ──
[⚙ Supabase 설정]
[☁ 업로드]         ← 전체 데이터 → Supabase
[↓ 모바일 병합]     ← 모바일 변경분 → 로컬
```

### 설정 모달
- Supabase URL (기본값 내장)
- Anon Key (기본값 내장)
- 비밀번호 입력 → app_config 검증
- localStorage에 저장 (폐쇄망 전용이므로 평문 허용)

### 업로드 함수
1. 인증 확인 (앱 비밀번호)
2. staff 데이터 → staff_master UPSERT
3. carry_over → UPSERT
4. notices (활성) → UPSERT
5. shift_data 전체 → UPSERT (source='desktop')

### 병합 함수
1. `source='mobile' AND updated_at > lastSyncAt` 조회
2. `mergeStaffData(local, remoteRows)` 실행
3. localStorage 저장 → autoSave() 트리거
4. lastSyncAt 갱신

---

## 11. manifest.json

```json
{
  "name": "시스템정보부 교대근무 일정표",
  "short_name": "교대일정",
  "start_url": "./shiftcal.html",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f9fafb",
  "theme_color": "#2563eb",
  "lang": "ko",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## 12. sw.js (Service Worker)

캐시 전략:
- 정적 파일 (html, manifest): Cache-First
- Supabase API (`supabase.co`): Network-First → 실패 시 캐시

---

## 13. 구현 순서

### 1단계: Supabase DB 초기화 ✅
- `supabase_setup.sql` 실행 완료

### 2단계: shiftcal.html 구현 ✅
- [x] 로그인 화면 (ID a/b/c/d + 비밀번호 / 교대외 비밀번호만)
- [x] localStorage 영구 로그인 유지
- [x] 달력 조회 (필터 뷰 / 전체 뷰 전환)
- [x] 날짜 상세 + 메모 입력/삭제 (과거 달 읽기 전용)
- [x] 잔여대휴 바
- [x] PWA 메타 태그

### 3단계: manifest.json + sw.js ✅
- [x] PWA manifest (shiftcal.html 기준)
- [x] Service Worker (Cache-First 정적 / Network-First API)

### 4단계: shiftCalendar.html 수정 ✅
- [x] 클라우드 섹션 HTML 추가 (☁ 업로드 / ↓ 병합 / ⚙ 설정)
- [x] 설정 모달 (비밀번호 검증 후 localStorage 저장)
- [x] 업로드 함수 (전체 데이터 → Supabase UPSERT)
- [x] 병합 함수 (현재달+ 모바일 변경분 → 로컬 merge)

### 5단계: GitHub Pages 배포
- [ ] GitHub 레포 생성
- [ ] 파일 push
- [ ] iPhone Safari → 홈화면 추가 테스트

---

## 14. 검증 체크리스트

- [ ] Supabase 대시보드에서 테이블 확인
- [ ] 폐쇄망 PC에서 업로드 → Supabase Row 생성 확인
- [ ] 모바일에서 달력 조회 → 동일 데이터 표시
- [ ] 모바일에서 메모 입력 → 폐쇄망에서 병합 후 JSON 확인
- [ ] iPhone Safari: 공유 → "홈 화면에 추가" → 앱 아이콘 생성 확인
- [ ] 비행기 모드에서 달력 조회 (Service Worker 캐시 동작)
- [ ] 비밀번호 오입력 시 에러 메시지 표시

---

## 15. 보안 고려사항

| 항목 | 수준 | 비고 |
|------|------|------|
| 비밀번호 전송 | 평문 HTTPS | 팀 내부 도구, 허용 |
| anon key 노출 | 공개 | RLS로 보호, 팀 외부 유출 시 키 교체 |
| RLS 정책 | anon 전체 허용 | 외부 공개 레포라면 key 직접 노출 주의 |
| XSS 방지 | escHtml/escAttr | 모든 HTML 삽입 시 적용 |

---

*이 문서를 기준으로 구현을 진행합니다.*
