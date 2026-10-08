export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** When posts go out: wall-clock times of day in an IANA time zone. */
export interface PostSchedule {
  /** At least one. */
  times: TimeOfDay[];
  timeZone: string;
  /** How late a post may still go out. Past this, it waits for the next time. */
  graceMs: number;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function parsePostTime(value: string): TimeOfDay {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error(`"${value}" is not a time of day (expected HH:MM, for example 12:00)`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** A comma-separated list of times of day, e.g. "00:00,06:00,12:00,18:00". */
export function parsePostTimes(value: string): TimeOfDay[] {
  const times = value
    .split(',')
    .filter((part) => part.trim().length > 0)
    .map(parsePostTime);
  if (times.length === 0) throw new Error('At least one posting time is needed (HH:MM, comma-separated)');
  return times;
}

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`"${timeZone}" is not a known time zone (use an IANA name such as Asia/Dubai)`);
  }
}

/** What the clocks in the zone show at the given instant. */
function wallClock(instant: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetAt(instant: number, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const shown = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return shown - Math.floor(instant / 1000) * 1000;
}

/** The moment the zone's clocks show `time` on the calendar day `dayOffset` days from `clock`'s. */
function slotOn(clock: WallClock, dayOffset: number, time: TimeOfDay, timeZone: string): number {
  // Date.UTC normalises a day of 0 or 32 into the neighbouring month.
  const shown = Date.UTC(clock.year, clock.month - 1, clock.day + dayOffset, time.hour, time.minute);
  // The offset is looked up twice: the first guess can land on the other side
  // of a clock change from the moment actually wanted.
  const guess = shown - offsetAt(shown, timeZone);
  return shown - offsetAt(guess, timeZone);
}

/** Every scheduled moment of yesterday, today and tomorrow in the zone. */
function slotsAround(now: number, schedule: PostSchedule): number[] {
  const today = wallClock(now, schedule.timeZone);
  return [-1, 0, 1].flatMap((dayOffset) =>
    schedule.times.map((time) => slotOn(today, dayOffset, time, schedule.timeZone)),
  );
}

/** The most recent scheduled moment at or before `now`. */
export function latestSlot(now: number, schedule: PostSchedule): number {
  return Math.max(...slotsAround(now, schedule).filter((slot) => slot <= now));
}

/** The first scheduled moment after `now`. */
export function nextSlot(now: number, schedule: PostSchedule): number {
  return Math.min(...slotsAround(now, schedule).filter((slot) => slot > now));
}

/**
 * A post is due from the scheduled moment until the grace period runs out,
 * unless one has already gone out since that moment.
 */
export function isPostDue(now: number, lastPostAt: string | null, schedule: PostSchedule): boolean {
  const slot = latestSlot(now, schedule);
  if (now - slot > schedule.graceMs) return false;
  return lastPostAt === null || Date.parse(lastPostAt) < slot;
}

/** An instant as people in the schedule's zone would read it, e.g. "Thu 8 Oct, 12:00 GMT+4". */
export function describeInstant(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(new Date(instant));
}
