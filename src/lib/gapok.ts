import { localDateStr } from "@/lib/utils";

type ScheduledGapokEvent = {
  due_date: string;
};

function epochDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function daysUntilGapok(dueDate: string, today = localDateStr()): number {
  return epochDay(dueDate) - epochDay(today);
}

export function summarizeGapokSchedule(
  events: ScheduledGapokEvent[],
  notificationDays: number,
  today = localDateStr(),
) {
  const windowDays = Math.max(1, Math.trunc(notificationDays));
  let overdue = 0;
  let dueToday = 0;
  let upcoming = 0;

  for (const event of events) {
    const days = daysUntilGapok(event.due_date, today);
    if (days <= 0) overdue += 1;
    if (days === 0) dueToday += 1;
    if (days > 0 && days <= windowDays) upcoming += 1;
  }

  return { overdue, dueToday, upcoming };
}
