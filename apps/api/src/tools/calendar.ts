/**
 * Calendar tool — Nylas v3 REST API integration.
 *
 * All functions accept raw Nylas credentials (grantId + apiKey) rather than a
 * userId so they can be called both from the agent loop (which resolves
 * credentials from Supabase) and standalone in tests.
 */

import type { Tool, CalendarEvent, Attendee } from '@coki/shared';
import type { ToolOutcome } from './types';
import { ok, err } from './types';

const NYLAS_BASE = process.env.NYLAS_API_URI ?? 'https://api.us.nylas.com';

// ─── Tool definitions (LLM-facing) ────────────────────────────────────────────

export const calendarTools: Tool[] = [
  {
    name: 'get_todays_events',
    description: "Returns all calendar events for the user's current day in their configured timezone.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_week_events',
    description: "Returns all calendar events for the current week (Mon–Sun) in the user's timezone.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_event',
    description: 'Creates a new calendar event on the primary calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title:     { type: 'string', description: 'Event title' },
        start:     { type: 'string', description: 'ISO 8601 start datetime' },
        end:       { type: 'string', description: 'ISO 8601 end datetime' },
        attendees: { type: 'array',  description: 'Optional list of attendee email addresses', items: { type: 'string' } },
        location:  { type: 'string', description: 'Optional location or conference link' },
      },
      required: ['title', 'start', 'end'],
    },
  },
  {
    name: 'update_event',
    description: 'Updates fields on an existing calendar event.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Nylas event ID' },
        fields:   { type: 'object', description: 'Fields to update (title, start, end, location, etc.)' },
      },
      required: ['event_id', 'fields'],
    },
  },
  {
    name: 'delete_event',
    description: 'Deletes a calendar event. Requires explicit user confirmation before calling.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Nylas event ID to delete' },
      },
      required: ['event_id'],
    },
  },
];

// ─── Nylas response → CalendarEvent ──────────────────────────────────────────

interface NylasEventTime {
  time?: number;
  start_time?: number;
  end_time?: number;
  date?: string;
  object?: string;
}

interface NylasParticipant {
  name?: string;
  email: string;
  status?: string;
}

interface NylasEvent {
  id: string;
  calendar_id: string;
  title: string;
  description?: string;
  location?: string;
  when: NylasEventTime & { start_time?: number; end_time?: number; start_date?: string; end_date?: string };
  participants?: NylasParticipant[];
  conferencing?: { details?: { url?: string } };
  created_at?: number;
  updated_at?: number;
}

/**
 * Signed minute offset from UTC for a given instant in a given IANA zone.
 * Uses Intl.DateTimeFormat `longOffset` (e.g. "GMT-06:00") so it is native and
 * dependency-free, and correctly handles DST since it is resolved per-instant.
 */
function getZoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  // "GMT", "GMT+00:00", "GMT-06:00", "UTC" — all acceptable.
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2] ?? '0', 10);
  const mins  = parseInt(match[3] ?? '0', 10);
  return sign * (hours * 60 + mins);
}

/**
 * Format a unix timestamp as an ISO-8601 string WITH the user's offset,
 * e.g. "2026-04-08T08:30:00-06:00". Claude can parse this and preserves the
 * wall-clock time when echoing it back, which is what we want.
 */
function toIsoWithOffset(unix: number, timezone: string): string {
  const d = new Date(unix * 1000);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const y = get('year');
  const m = get('month');
  const day = get('day');
  // en-CA + hour12:false sometimes returns "24" for midnight — normalize to "00".
  let hh = get('hour');
  if (hh === '24') hh = '00';
  const mm = get('minute');
  const ss = get('second');

  const offsetMin = getZoneOffsetMinutes(d, timezone);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`;
}

function toIso(
  timezone: string,
  unix?: number,
  date?: string,
): string {
  if (unix) return toIsoWithOffset(unix, timezone);
  if (date) return date; // all-day events are already a Y-M-D date string
  return '';
}

function normalizeEvent(e: NylasEvent, timezone: string): CalendarEvent {
  const allDay = !!e.when.date || !!e.when.start_date;
  return {
    id:           e.id,
    calendarId:   e.calendar_id,
    title:        e.title,
    description:  e.description,
    location:     e.location,
    start:        toIso(timezone, e.when.start_time ?? e.when.time, e.when.date ?? e.when.start_date),
    end:          toIso(timezone, e.when.end_time,                  e.when.end_date),
    allDay,
    attendees:    e.participants?.map<Attendee>((p) => ({
      name:   p.name,
      email:  p.email,
      status: (p.status as Attendee['status']) ?? 'noreply',
    })),
    conferenceUrl: e.conferencing?.details?.url,
    createdAt:     e.created_at ? toIso(timezone, e.created_at) : undefined,
    updatedAt:     e.updated_at ? toIso(timezone, e.updated_at) : undefined,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function nylasGet<T>(
  grantId: string,
  apiKey: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${NYLAS_BASE}/v3/grants/${grantId}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Nylas GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function nylasPost<T>(
  grantId: string,
  apiKey: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${NYLAS_BASE}/v3/grants/${grantId}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Nylas POST ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function nylasPut<T>(
  grantId: string,
  apiKey: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${NYLAS_BASE}/v3/grants/${grantId}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Nylas PUT ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function nylasDelete(
  grantId: string,
  apiKey: string,
  path: string,
): Promise<void> {
  const res = await fetch(`${NYLAS_BASE}/v3/grants/${grantId}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Nylas DELETE ${path} failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Returns [startUnix, endUnix) for the day that "today + offsetDays" lands on
 * in the user's timezone, regardless of the server's timezone.
 *
 * Works by:
 *   1. Finding Y/M/D in the target zone right now.
 *   2. Guessing that Y/M/D's midnight as UTC.
 *   3. Asking what the zone offset is AT that guessed instant and subtracting
 *      it. This is correct even across DST transitions because the offset is
 *      resolved from the candidate instant itself.
 */
function dayBoundsUnix(timezone: string, offsetDays = 0): { start: number; end: number } {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = dtf.format(now).split('-').map(Number);

  // Candidate unix for midnight in the target zone. First guess: UTC midnight
  // of that Y/M/D, then shift by the zone offset at that instant.
  const utcGuessMs = Date.UTC(year!, month! - 1, day! + offsetDays);
  const offsetMin = getZoneOffsetMinutes(new Date(utcGuessMs), timezone);
  const startMs = utcGuessMs - offsetMin * 60_000;

  return {
    start: Math.floor(startMs / 1000),
    end:   Math.floor(startMs / 1000) + 86400,
  };
}

function weekBoundsUnix(timezone: string): { start: number; end: number } {
  const today = dayBoundsUnix(timezone);
  const now = new Date();
  const dow = now.getDay(); // 0 = Sun
  const daysToMon = (dow === 0 ? -6 : 1 - dow);
  const monStart = today.start + daysToMon * 86400;
  return { start: monStart, end: monStart + 7 * 86400 };
}

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Fetch events for a specific time range from the user's primary calendar.
 *
 * @param grantId  Nylas grant ID for the user.
 * @param apiKey   Nylas API key.
 * @param start    Unix timestamp (seconds) — range start.
 * @param end      Unix timestamp (seconds) — range end.
 */
export async function getEvents(
  grantId: string,
  apiKey: string,
  start: number,
  end: number,
  timezone: string,
): Promise<ToolOutcome<CalendarEvent[]>> {
  try {
    const data = await nylasGet<{ data: NylasEvent[] }>(grantId, apiKey, '/events', {
      calendar_id: 'primary',
      start:       String(start),
      end:         String(end),
      limit:       '100',
    });
    return ok(data.data.map((e) => normalizeEvent(e, timezone)));
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}

/**
 * Fetch all events for the user's current day in their timezone.
 *
 * @param grantId   Nylas grant ID.
 * @param apiKey    Nylas API key.
 * @param timezone  IANA timezone string (e.g. "America/Denver").
 */
export async function getTodaysEvents(
  grantId: string,
  apiKey: string,
  timezone: string,
): Promise<ToolOutcome<CalendarEvent[]>> {
  const { start, end } = dayBoundsUnix(timezone);
  return getEvents(grantId, apiKey, start, end, timezone);
}

/**
 * Fetch all events for the current Mon–Sun week.
 *
 * @param grantId   Nylas grant ID.
 * @param apiKey    Nylas API key.
 * @param timezone  IANA timezone string.
 */
export async function getWeekEvents(
  grantId: string,
  apiKey: string,
  timezone: string,
): Promise<ToolOutcome<CalendarEvent[]>> {
  const { start, end } = weekBoundsUnix(timezone);
  return getEvents(grantId, apiKey, start, end, timezone);
}

export interface CreateEventInput {
  title: string;
  start: string;
  end: string;
  attendees?: string[];
  location?: string;
  description?: string;
}

/**
 * Create a new event on the user's primary calendar.
 *
 * @param grantId  Nylas grant ID.
 * @param apiKey   Nylas API key.
 * @param event    Event fields.
 */
export async function createEvent(
  grantId: string,
  apiKey: string,
  event: CreateEventInput,
  timezone: string,
): Promise<ToolOutcome<CalendarEvent>> {
  try {
    const startUnix = Math.floor(new Date(event.start).getTime() / 1000);
    const endUnix   = Math.floor(new Date(event.end).getTime() / 1000);

    const body = {
      title:        event.title,
      description:  event.description,
      location:     event.location,
      when:         { start_time: startUnix, end_time: endUnix },
      participants: event.attendees?.map((email) => ({ email })),
    };

    const data = await nylasPost<{ data: NylasEvent }>(grantId, apiKey, '/events?calendar_id=primary', body);
    return ok(normalizeEvent(data.data, timezone));
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}

/**
 * Update fields on an existing calendar event.
 *
 * @param grantId  Nylas grant ID.
 * @param apiKey   Nylas API key.
 * @param eventId  Nylas event ID.
 * @param updates  Partial event fields to update.
 */
export async function updateEvent(
  grantId: string,
  apiKey: string,
  eventId: string,
  updates: Partial<CreateEventInput>,
  timezone: string,
): Promise<ToolOutcome<CalendarEvent>> {
  try {
    const body: Record<string, unknown> = {};
    if (updates.title)       body.title       = updates.title;
    if (updates.description) body.description  = updates.description;
    if (updates.location)    body.location     = updates.location;
    if (updates.attendees)   body.participants = updates.attendees.map((email) => ({ email }));
    if (updates.start || updates.end) {
      body.when = {
        ...(updates.start ? { start_time: Math.floor(new Date(updates.start).getTime() / 1000) } : {}),
        ...(updates.end   ? { end_time:   Math.floor(new Date(updates.end).getTime()   / 1000) } : {}),
      };
    }

    const data = await nylasPut<{ data: NylasEvent }>(
      grantId, apiKey, `/events/${eventId}?calendar_id=primary`, body,
    );
    return ok(normalizeEvent(data.data, timezone));
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}

/**
 * Delete a calendar event. Must only be called after explicit user confirmation.
 *
 * @param grantId  Nylas grant ID.
 * @param apiKey   Nylas API key.
 * @param eventId  Nylas event ID to delete.
 */
export async function deleteEvent(
  grantId: string,
  apiKey: string,
  eventId: string,
): Promise<ToolOutcome<{ deleted: true }>> {
  try {
    await nylasDelete(grantId, apiKey, `/events/${eventId}?calendar_id=primary`);
    return ok({ deleted: true });
  } catch (e) {
    return err((e as Error).message, 'NYLAS_ERROR');
  }
}
