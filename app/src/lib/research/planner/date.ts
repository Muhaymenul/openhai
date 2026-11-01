/** Local, deterministic suggestions only. The user confirms the resulting form. */
export function parseDeadlineText(text: string, now = new Date()) {
  const normalized = text.replace(
    /([零一二两三四五六七八九十]{1,3})(?=[点时分])/g,
    (_match, value: string) => {
      const digits = "零一二三四五六七八九";
      const number = value.replaceAll("两", "二");
      const parts = number.split("十");
      const hour =
        parts.length === 2
          ? (parts[0] ? digits.indexOf(parts[0]) : 1) * 10 +
            (parts[1] ? digits.indexOf(parts[1]) : 0)
          : digits.indexOf(number);
      return String(hour);
    },
  );
  const localNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  );
  let day: Date | undefined;
  const absolute = /(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/.exec(text);
  if (absolute) {
    const year = Number(absolute[1]);
    const month = Number(absolute[2]);
    const date = Number(absolute[3]);
    const candidate = new Date(Date.UTC(year, month - 1, date));
    if (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === date
    )
      day = candidate;
  } else if (/后天/.test(text)) day = new Date(today + 2 * 86400000);
  else if (/明天/.test(text)) day = new Date(today + 86400000);
  else if (/今天/.test(text)) day = new Date(today);
  else {
    const week = /(下周|本周|这周|周|星期)([一二三四五六日天])/.exec(text);
    if (week) {
      const weekday = "日一二三四五六".indexOf(
        week[2] === "天" ? "日" : week[2],
      );
      const current = new Date(today).getUTCDay();
      let delta = (weekday - current + 7) % 7;
      if (week[1] === "下周")
        delta = ((weekday + 6) % 7) - ((current + 6) % 7) + 7;
      if (week[1] === "本周" || week[1] === "这周")
        delta = ((weekday + 6) % 7) - ((current + 6) % 7);
      day = new Date(today + delta * 86400000);
    }
  }
  const time =
    /(上午|下午|晚上|中午|早上)?\s*(\d{1,2})(?::(\d{2})(?!\d)|[点时](半|\d{1,2}分?)?)/.exec(
      normalized,
    );
  let hour = time ? Number(time[2]) : 17;
  let minute = time?.[3]
    ? Number(time[3])
    : time?.[4] === "半"
      ? 30
      : Number(time?.[4]?.replace("分", "") || 0);
  if (time?.[1] && /下午|晚上|中午/.test(time[1]) && hour < 12) hour += 12;
  if (time?.[1] && /上午|早上/.test(time[1]) && hour === 12) hour = 0;
  const unsupportedTime =
    !time && /(上午|下午|晚上|中午|早上|\d[点时]|\d:\d)/.test(normalized);
  const leftoverTime =
    time &&
    /^(?:[零一二两三四五六七八九十\d]|半|刻)/.test(
      normalized.slice(time.index + time[0].length),
    );
  if (hour > 23 || minute > 59 || unsupportedTime || leftoverTime) {
    day = undefined;
    hour = 17;
    minute = 0;
  }
  const datePart = day?.toISOString().slice(0, 10);
  const dueLocal = datePart
    ? `${datePart}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : "";
  const title = normalized
    .replace(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/, "")
    .replace(/今天|明天|后天|(下周|本周|这周|周|星期)[一二三四五六日天]/, "")
    .replace(
      /(上午|下午|晚上|中午|早上)?\s*\d{1,2}(?::\d{2}|[点时](?:半|\d{1,2}分?)?)/,
      "",
    )
    .replace(/之前|以前|截止|到期|请提醒我|提醒我|我要|我需要/g, "")
    .replace(/^[，,\s]+|[，,\s]+$/g, "");
  return {
    title: title || text.trim(),
    dueLocal,
    priority: /紧急|重要|优先/.test(text)
      ? ("high" as const)
      : ("normal" as const),
  };
}

export function shanghaiInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16);
}
