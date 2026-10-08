import type { NewPost } from './cormonity-client/types.js';
import type { Announcement } from './sources/types.js';

// The Cormonity post body limit.
const MAX_BODY_LENGTH = 5000;

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Dubai',
});
const NUMBER = new Intl.NumberFormat('en-US');

function when(item: Announcement): string | null {
  // A source that gives its dates as words gives whole days, with no time
  // zone; its own wording is kept rather than shifted into Dubai time.
  if (item.dateText) return item.dateText;
  if (item.startsAt) {
    const start = DATE.format(new Date(item.startsAt));
    const end = item.endsAt ? DATE.format(new Date(item.endsAt)) : start;
    return start === end ? start : `${start} – ${end}`;
  }
  return null;
}

function render(item: Announcement, title: string): string {
  const facts: string[] = [];
  const date = when(item);
  if (date) facts.push(`When: ${date}`);
  const place = item.online ? 'Online' : item.location;
  if (place) facts.push(`Where: ${place}`);
  if (item.prize) facts.push(`Prizes: ${item.prize}`);
  if (item.organizer) facts.push(`Organiser: ${item.organizer}`);
  if (item.popularity !== null && item.popularity > 0) {
    facts.push(`Registered so far: ${NUMBER.format(item.popularity)}`);
  }

  const blocks = [title];
  if (facts.length > 0) blocks.push(facts.join('\n'));
  blocks.push(`Register: ${item.url}`, `Found on ${item.source}.`);
  return blocks.join('\n\n');
}

/** One post about one hackathon: what it is, when, where, and where to register. */
export function composePost(item: Announcement): NewPost {
  let body = render(item, item.title);
  if (body.length > MAX_BODY_LENGTH) {
    // Only the title is free text of unknown length. It is the part that
    // gives way, so the registration link always survives whole.
    const keep = Math.max(item.title.length - (body.length - MAX_BODY_LENGTH) - 1, 0);
    body = render(item, `${item.title.slice(0, keep)}…`);
  }
  return { body, linkUrl: item.url };
}

/** Every http(s) link in a post body — how the bot recognises what it has already posted. */
export function linksIn(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
}
