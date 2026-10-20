// Parses and formats due dates as day numbers counted from 1 Oct 2026; today is day 18. Mockup only.
const TODAY = 18;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = { oct: 0, nov: 31, dec: 61 };
// INVARIANT: the brief fixes today as a Saturday, so weekdays are counted from that, not from the real 2026 calendar.
const weekdayOf = (d) => WEEKDAYS[(((d - TODAY + 6) % 7) + 7) % 7];
const nextWeekday = (idx) => TODAY + (((idx - 6) % 7 + 7) % 7 || 7);

function parseDate(raw) {
  const s = raw.trim().toLowerCase().replace(/^the\s+/, "");
  if (s === "today") return TODAY;
  if (s === "tomorrow") return TODAY + 1;
  if (/^end of (the )?week$/.test(s)) return nextWeekday(5);
  const wd = WEEKDAYS.findIndex((w) => s.startsWith(w.toLowerCase()));
  if (wd >= 0 && /^[a-z]+$/.test(s)) return nextWeekday(wd);
  const m = s.match(/^(\d{1,2})\s+(oct|nov|dec)/) || s.match(/^(oct|nov|dec)\w*\s+(\d{1,2})$/);
  if (!m) return null;
  const [day, mon] = /\d/.test(m[1]) ? [+m[1], m[2]] : [+m[2], m[1]];
  return MONTHS[mon] + day;
}

function fmtDate(d) {
  const [mon, base] = d > 61 ? ["Dec", 61] : d > 31 ? ["Nov", 31] : ["Oct", 0];
  return `${d - base} ${mon}`;
}
const fmtDay = (d) => (d == null ? "no date" : `${weekdayOf(d)} ${fmtDate(d)}`);
const relDay = (d) => (d == null ? "no date" : d === TODAY ? "today" : d === TODAY + 1 ? "tomorrow" : d < TODAY ? `overdue · ${fmtDate(d)}` : fmtDay(d));

// Desk sections: Today holds anything due today, overdue or undated; This week runs to next Saturday.
const bucketOf = (d) => (d == null || d <= TODAY ? "today" : d <= TODAY + 7 ? "week" : "later");
const BUCKET_LABEL = { today: "Today", week: "This week", later: "Later" };
