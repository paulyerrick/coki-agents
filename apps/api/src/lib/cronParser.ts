/**
 * cronParser — converts plain-English schedule descriptions to 5-field cron
 * expressions, and provides a helper for converting expressions back to a
 * human-readable string.
 *
 * Common patterns are handled locally without an API call.  Anything the
 * local rules can't match falls back to a single Claude Haiku call.
 */

import Anthropic from '@anthropic-ai/sdk';

// ─── Internal helpers ─────────────────────────────────────────────────────────

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function parseHour(raw: number, ampm: string | undefined): number {
  if (!ampm) return raw;
  const p = ampm.toLowerCase();
  if (p === 'pm' && raw !== 12) return raw + 12;
  if (p === 'am' && raw === 12) return 0;
  return raw;
}

// ─── Local pattern table ──────────────────────────────────────────────────────

const LOCAL_PATTERNS: Array<{
  regex: RegExp;
  build: (m: RegExpMatchArray) => string;
}> = [
  // "every hour"
  {
    regex: /^every\s+hour$/i,
    build: () => '0 * * * *',
  },
  // "every N minutes"
  {
    regex: /^every\s+(\d+)\s+minutes?$/i,
    build: (m) => `*/${m[1]!} * * * *`,
  },
  // "every N hours"
  {
    regex: /^every\s+(\d+)\s+hours?$/i,
    build: (m) => `0 */${m[1]!} * * *`,
  },
  // "every day at 7am" / "every day at 7:30 pm"
  {
    regex: /^every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    build: (m) => {
      const h = parseHour(parseInt(m[1]!, 10), m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return `${min} ${h} * * *`;
    },
  },
  // "every weekday at 9am"
  {
    regex: /^every\s+weekday\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    build: (m) => {
      const h = parseHour(parseInt(m[1]!, 10), m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return `${min} ${h} * * 1-5`;
    },
  },
  // "every weekend at 10am"
  {
    regex: /^every\s+weekend\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    build: (m) => {
      const h = parseHour(parseInt(m[1]!, 10), m[3]);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      return `${min} ${h} * * 0,6`;
    },
  },
  // "every Monday at 6am" / "every Sunday at 8pm"
  {
    regex: /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    build: (m) => {
      const dayNum = DAY_MAP[m[1]!.toLowerCase()]!;
      const h = parseHour(parseInt(m[2]!, 10), m[4]);
      const min = m[3] ? parseInt(m[3], 10) : 0;
      return `${min} ${h} * * ${dayNum}`;
    },
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a plain-English schedule description to a 5-field cron expression.
 *
 * Examples:
 *   "every day at 7am"        → "0 7 * * *"
 *   "every Monday at 6am"     → "0 6 * * 1"
 *   "every weekday at 9am"    → "0 9 * * 1-5"
 *   "every hour"              → "0 * * * *"
 *   "every Sunday at 8pm"     → "0 20 * * 0"
 *
 * @param input  Natural-language description, e.g. "every Monday at 7am".
 * @returns      A standard 5-field cron expression.
 * @throws       If neither local patterns nor Claude can parse the input.
 */
export async function naturalLanguageToCron(input: string): Promise<string> {
  const normalized = input.trim();

  // Try local patterns first (no API call)
  for (const { regex, build } of LOCAL_PATTERNS) {
    const m = normalized.match(regex);
    if (m) return build(m);
  }

  // Fall back to Claude Haiku for anything more complex
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [
      {
        role: 'user',
        content:
          `Convert this schedule description to a standard 5-field cron expression ` +
          `(minute hour day-of-month month day-of-week). ` +
          `Reply with ONLY the cron expression and nothing else.\n\nSchedule: "${normalized}"`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim();

  // Basic structural validation: five whitespace-separated fields
  if (!/^[\d*,/\-]+ [\d*,/\-]+ [\d*,/\-]+ [\d*,/\-]+ [\d*,/\-]+$/.test(text)) {
    throw new Error(
      `Could not parse "${input}" as a schedule. ` +
      `Try a simpler description like "every day at 7am" or "every Monday at 9am".`,
    );
  }

  return text;
}

/**
 * Convert a 5-field cron expression to a short human-readable label.
 * Best-effort — complex expressions fall back to the raw cron string.
 *
 * @param expr  5-field cron expression.
 * @returns     Human-readable string, e.g. "Every Monday at 7:00 AM".
 */
export function cronToHuman(expr: string): string {
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;

  const [minStr, hourStr, , , wdStr] = parts;

  // Every N minutes: "*/5 * * * *"
  if (minStr?.startsWith('*/') && hourStr === '*' && wdStr === '*') {
    return `Every ${minStr.slice(2)} minutes`;
  }

  // Every hour: "0 * * * *"
  if (minStr === '0' && hourStr === '*' && wdStr === '*') return 'Every hour';

  // Every N hours: "0 */2 * * *"
  if (hourStr?.startsWith('*/') && wdStr === '*') {
    return `Every ${hourStr.slice(2)} hours`;
  }

  // All remaining patterns need a fixed hour
  const cronHour = parseInt(hourStr ?? '0', 10);
  const cronMin  = parseInt(minStr  ?? '0', 10);
  if (isNaN(cronHour) || isNaN(cronMin)) return expr;

  const h12   = cronHour % 12 === 0 ? 12 : cronHour % 12;
  const ampm  = cronHour < 12 ? 'AM' : 'PM';
  const timeStr = `${h12}:${String(cronMin).padStart(2, '0')} ${ampm}`;

  if (wdStr === '*')   return `Every day at ${timeStr}`;
  if (wdStr === '1-5') return `Every weekday at ${timeStr}`;
  if (wdStr === '0,6') return `Every weekend at ${timeStr}`;

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayNum = parseInt(wdStr ?? '', 10);
  if (!isNaN(dayNum) && DAY_NAMES[dayNum]) {
    return `Every ${DAY_NAMES[dayNum]} at ${timeStr}`;
  }

  return expr;
}

/**
 * Compute the next N dates that a 5-field cron expression will fire.
 * Supports the most common patterns; very exotic expressions fall back to
 * returning `count` copies of "now + 24 hours".
 *
 * @param expr   5-field cron expression.
 * @param count  Number of future dates to return (default 5).
 * @returns      Array of Date objects in ascending order.
 */
export function getNextRunDates(expr: string, count = 5): Date[] {
  const parts = expr.split(' ');
  if (parts.length !== 5) {
    return Array.from({ length: count }, (_, i) =>
      new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
    );
  }

  const [minStr, hourStr, , , wdStr] = parts;
  const now = new Date();
  const results: Date[] = [];

  // Every N minutes: "*/N * * * *"
  if (minStr?.startsWith('*/')) {
    const interval = parseInt(minStr.slice(2), 10) * 60 * 1000;
    for (let i = 1; i <= count; i++) results.push(new Date(Date.now() + i * interval));
    return results;
  }

  // Every N hours: "0 */N * * *"
  if (hourStr?.startsWith('*/')) {
    const interval = parseInt(hourStr.slice(2), 10) * 60 * 60 * 1000;
    for (let i = 1; i <= count; i++) results.push(new Date(Date.now() + i * interval));
    return results;
  }

  // Every hour: "0 * * * *"
  if (hourStr === '*') {
    const cronMin = parseInt(minStr ?? '0', 10);
    let cursor = new Date(now);
    cursor.setSeconds(0); cursor.setMilliseconds(0);
    cursor.setMinutes(cronMin);
    if (cursor <= now) cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    for (let i = 0; i < count; i++) {
      results.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    }
    return results;
  }

  // Fixed hour + minute — find next N occurrences up to 7 days out
  const cronHour = parseInt(hourStr!, 10);
  const cronMin  = parseInt(minStr!,  10);
  if (isNaN(cronHour) || isNaN(cronMin)) {
    return Array.from({ length: count }, (_, i) =>
      new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
    );
  }

  // Build a whitelist of allowed weekdays (0-6)
  let allowedDays: Set<number>;
  if (!wdStr || wdStr === '*') {
    allowedDays = new Set([0, 1, 2, 3, 4, 5, 6]);
  } else if (wdStr === '1-5') {
    allowedDays = new Set([1, 2, 3, 4, 5]);
  } else if (wdStr === '0,6') {
    allowedDays = new Set([0, 6]);
  } else {
    allowedDays = new Set(
      wdStr.split(',').map(Number).filter((n) => !isNaN(n)),
    );
  }

  let cursor = new Date(now);
  for (let day = 0; day <= 7 * count && results.length < count; day++) {
    const d = new Date(cursor);
    d.setDate(d.getDate() + day);
    d.setHours(cronHour, cronMin, 0, 0);
    if (allowedDays.has(d.getDay()) && d > now) {
      results.push(d);
    }
  }

  return results;
}
