// Supabase Edge Function: send-push (배치 모드)
// pg_cron이 3분마다 호출 → 그 사이 변경된 shift_data를 모아 구독 기기에 "요약 푸시 1번" 발송
// 행마다 보내지 않으므로 대량 수정에도 알림은 1번으로 묶임.
//
// 배포:  supabase functions deploy send-push --no-verify-jwt
// secret: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com WEBHOOK_SECRET=...
// 스케줄: PUSH_SETUP.md의 pg_cron 설정 참고 (*/3 * * * *)
//
// 환경변수(자동 주입): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const HOOK_SECRET = Deno.env.get("WEBHOOK_SECRET"); // 설정 시에만 검증

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const sbHeaders = {
  "apikey": SB_SERVICE_KEY,
  "Authorization": `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// 'YYYY-MM-DD' → 'M/D(요일)'
function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, day).getDay()];
  return `${m}/${day}(${wd})`;
}

Deno.serve(async (req) => {
  try {
    // cron(pg_net)이 공개 URL로 호출하므로 시크릿 헤더로 인증
    if (HOOK_SECRET && req.headers.get("x-webhook-secret") !== HOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    // 1. 마지막 발송 시각
    const stRes = await fetch(
      `${SB_URL}/rest/v1/push_state?id=eq.1&select=last_pushed_at`,
      { headers: sbHeaders },
    );
    const since: string | undefined = (await stRes.json())[0]?.last_pushed_at;
    if (!since) {
      // 상태 행이 없으면 지금 시각으로 초기화만 하고 종료
      await fetch(`${SB_URL}/rest/v1/push_state`, {
        method: "POST",
        headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ id: 1, last_pushed_at: new Date().toISOString() }),
      });
      return new Response(JSON.stringify({ init: true }), { status: 200 });
    }

    // 2. 지난 주기 동안 바뀐 행 (오래된 순). limit은 비정상적 대량에 대한 런어웨이 가드.
    const rowsRes = await fetch(
      `${SB_URL}/rest/v1/shift_data?updated_at=gt.${encodeURIComponent(since)}` +
      `&select=date,memo,updated_at&order=updated_at.asc&limit=2000`,
      { headers: sbHeaders },
    );
    const rows: { date: string; memo: string[]; updated_at: string }[] = await rowsRes.json();
    if (!rows.length) {
      return new Response(JSON.stringify({ sent: 0, changes: 0 }), { status: 200 });
    }

    // 2-1. 발송 전에 먼저 last_pushed_at을 선점 갱신(=이번에 본 최신 updated_at).
    //      발송 후 갱신하면 PATCH 실패 시 다음 주기에 같은 변경을 또 보내 중복 알림이 됨.
    //      먼저 갱신하면 최악의 경우 "발송 실패 시 누락"이지만, 중복 스팸보다 낫고 다음 변경 때 재알림됨.
    const newSince = rows[rows.length - 1].updated_at;
    await fetch(`${SB_URL}/rest/v1/push_state?id=eq.1`, {
      method: "PATCH",
      headers: { ...sbHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({ last_pushed_at: newSince }),
    });

    // 3. 요약 본문 — 단건이면 메모까지, 여러 건이면 날짜 목록으로 묶음
    let body: string;
    if (rows.length === 1) {
      const r = rows[0];
      const memoFirst = Array.isArray(r.memo) && r.memo.length ? ` · ${r.memo[0]}` : "";
      body = `${fmtDate(r.date)} 일정이 변경되었습니다${memoFirst}`;
    } else {
      const uniq = [...new Set(rows.map((r) => fmtDate(r.date)))];
      const head = uniq.slice(0, 4).join(", ");
      body = `${uniq.length}일 일정 변경: ${head}${uniq.length > 4 ? " 외" : ""}`;
    }
    const notif = JSON.stringify({
      title: "교대일정 변경",
      body,
      url: "./shiftcal.html",
      tag: "shiftcal",
      renotify: true, // 새 묶음이 오면 다시 알림(소리/진동)
    });

    // 4. 구독 전체에 발송
    const subsRes = await fetch(
      `${SB_URL}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth`,
      { headers: sbHeaders },
    );
    const subs: { endpoint: string; p256dh: string; auth: string }[] = await subsRes.json();

    let sent = 0;
    const expired: string[] = [];
    await Promise.all(subs.map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, notif);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) expired.push(s.endpoint);
      }
    }));

    // 5. 만료 구독 정리 (endpoint별 eq DELETE)
    await Promise.all(expired.map((e) =>
      fetch(
        `${SB_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(e)}`,
        { method: "DELETE", headers: sbHeaders },
      )
    ));

    return new Response(
      JSON.stringify({ sent, expired: expired.length, changes: rows.length, devices: subs.length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
