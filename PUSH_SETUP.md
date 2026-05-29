# 아이폰 푸시 알림 설정 가이드 (Safari PWA + Web Push, 3분 배치)

달력 일정/메모가 바뀌면 아이폰 잠금화면에 알림이 가도록 하는 기능의 **배포·운영 설정** 문서.
코드(서비스워커·구독 로직·Edge Function)는 이미 반영됨. 아래는 **1회성 인프라 설정**.

> ⚠️ iOS 크롬은 불가. 사용자는 **Safari → 공유 → "홈 화면에 추가" → 그 아이콘으로 실행**해야 함 (iOS 16.4+).

**발송 방식:** 실시간 즉시가 아니라 **pg_cron이 3분마다** 호출 → 그 사이 변경분을 **모아 1번** 발송.
단건이면 메모까지, 여러 건이면 "N일 일정 변경: 날짜들"로 요약. 대량 수정도 1번으로 묶임.

---

## 1. Supabase 테이블 생성
Dashboard → SQL Editor에서 아래 실행.
(`supabase_setup.sql`에도 반영돼 있으나 그 파일은 .gitignore 대상이라, 보존용으로 여기 동봉)
```sql
-- 웹 푸시 구독 (아이폰 Safari PWA 알림)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT        PRIMARY KEY,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  role       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_push_subs" ON push_subscriptions
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- 3분 배치 발송용 마지막 발송 시각 (단일 행)
CREATE TABLE IF NOT EXISTS push_state (
  id             INT         PRIMARY KEY DEFAULT 1,
  last_pushed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_state_single_row CHECK (id = 1)
);
INSERT INTO push_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE push_state ENABLE ROW LEVEL SECURITY;  -- 정책 없음 = anon 차단, service_role만 접근

CREATE INDEX IF NOT EXISTS idx_shift_data_updated_at ON shift_data(updated_at);
```

## 2. VAPID 키
키 쌍은 이미 생성됨.
- **공개키**: `shiftcal.html`의 `VAPID_PUBLIC_KEY` 상수에 반영 완료.
- **개인키**: 깃·HTML에 절대 두지 말 것. 아래 secret으로만 등록 (값은 별도 전달받은 것 사용).

새로 만들려면: `npx web-push generate-vapid-keys`

## 3. Edge Function 배포
```bash
# Supabase CLI 설치/로그인 후, 프로젝트 루트에서
supabase functions deploy send-push --no-verify-jwt

# secret 등록 (개인키는 채팅으로 전달받은 값 사용)
supabase secrets set \
  VAPID_PUBLIC_KEY='BKbGDEEdPwSRBPZJ3D9tczsIE0b8YcMlQZqBOP-FuPjU9ekzcpGO9k7QGY8Mk3MOjtETPHkrSG8FK0Mgi7okyS4' \
  VAPID_PRIVATE_KEY='<개인키-채팅으로-전달>' \
  VAPID_SUBJECT='mailto:leesy@linkprice.com' \
  WEBHOOK_SECRET='<임의의-긴-랜덤문자열>'
```
`--no-verify-jwt`: cron(pg_net)이 JWT 없이 호출하므로 필요.
함수 URL을 아는 누구나 호출 가능하므로 `WEBHOOK_SECRET`을 꼭 설정 → 4단계 cron 헤더로 인증.

## 4. 3분 주기 스케줄 (pg_cron + pg_net)
Dashboard → Database → Extensions에서 **`pg_cron`, `pg_net`** 활성화. 그 후 SQL Editor에서:
```sql
-- <ref> = 프로젝트 ref, <secret> = 3단계 WEBHOOK_SECRET 값
select cron.schedule(
  'shiftcal-push-3min',
  '*/3 * * * *',
  $$
  select net.http_post(
    url     := 'https://<ref>.functions.supabase.co/send-push',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', '<secret>'
               ),
    body    := '{}'::jsonb
  );
  $$
);
```
해제: `select cron.unschedule('shiftcal-push-3min');`
주기 변경: 위 `*/3`을 원하는 분으로(`*/5` 등) 바꿔 다시 schedule.

> Database Webhook은 **사용하지 않음** (행마다 즉시 발송이 아니라 cron 배치이므로).

## 5. 사용자 안내 (각 아이폰 1회)
1. **Safari**로 사이트 접속 (https://soulmatelibrary-ux.github.io/shift-calendar/shiftcal.html)
2. 공유 버튼 → **홈 화면에 추가**
3. **홈 화면 아이콘으로 실행** (Safari 탭 아님)
4. 우상단 🔔 버튼 → iOS 권한 팝업 **허용** (켜지면 버튼이 초록색)
   → `push_subscriptions`에 row 생성되면 성공

## 검증
- 다른 기기에서 아무 날짜 메모 저장 → **최대 3분 내** 아이폰(앱 닫힌 상태)에 알림 도착
- 여러 날짜를 연속 수정 → 다음 주기에 "N일 일정 변경" 1건으로 묶여 도착
- 알림 탭 → 앱 열림
- Edge Function 로그(Dashboard → Functions → send-push → Logs)에서 `{sent, changes, devices}` 확인
- cron 동작: `select * from cron.job;`, 실행이력 `select * from cron.job_run_details order by start_time desc limit 10;`

## 동작 메모
- 발송 지연 = 최대 3분 (배치 주기). 더 빠르게 원하면 주기를 줄이면 됨(`*/1` 등).
- `last_pushed_at`은 NOW()가 아니라 **실제 처리한 가장 최신 `updated_at`**으로 갱신 → 처리 중 들어온 변경 누락 없음.
- 알림은 `tag:'shiftcal'` + `renotify:true` → 기기 화면엔 1개로 유지되되 새 묶음마다 다시 알림.
