/**
 * 서울(Asia/Seoul) 기준 해당 시각이 속한 주의 월요일 00:00:00을 epoch ms로 반환.
 * 일요일 24:00(= 다음날 월요일 00:00)에 새 주가 시작되며, 그 시점 이전 주 메시지는 다른 weekStart를 갖게 됩니다.
 */
const WD_TO_OFFSET = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function pad2(n) {
  return String(n).padStart(2, "0");
}

function seoulCalendarParts(ms) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    f.formatToParts(new Date(ms)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    wd: parts.weekday,
  };
}

export function seoulMondayStartMs(nowMs = Date.now()) {
  const { y, mo, d, wd } = seoulCalendarParts(nowMs);
  const off = WD_TO_OFFSET[wd];
  if (off === undefined) {
    return seoulMondayStartMs(nowMs - 86400000);
  }
  const base = Date.parse(`${pad2(y)}-${pad2(mo)}-${pad2(d)}T12:00:00+09:00`);
  const mondayMidMs = base - off * 86400000;
  const mp = seoulCalendarParts(mondayMidMs);
  return Date.parse(`${pad2(mp.y)}-${pad2(mp.mo)}-${pad2(mp.d)}T00:00:00+09:00`);
}
