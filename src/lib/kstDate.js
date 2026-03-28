/** 한국 표준시 기준 오늘 날짜 `yyyy-mm-dd` */
export function ymdInSeoulNow() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}
