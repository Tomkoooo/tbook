import { eventDayKeys, todayDayKey } from "@tbook/domain";

/** The fields of an event the station pickers need to decide what is on today. */
export interface StationEventDates {
  status: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Orders the events of a station picker (door, counter): the ones running
 * today first — status active and today (Europe/Budapest) within start..end —
 * then the rest in their given order. Pure, so it is unit tested.
 */
export function orderTodayFirst<T extends StationEventDates>(events: readonly T[], now: Date = new Date()): Array<{ event: T; today: boolean }> {
  const today = todayDayKey(now);
  const rows = events.map((event) => ({
    event,
    today: event.status === "active" && eventDayKeys(event.startDate, event.endDate).includes(today),
  }));
  return [...rows.filter((row) => row.today), ...rows.filter((row) => !row.today)];
}
