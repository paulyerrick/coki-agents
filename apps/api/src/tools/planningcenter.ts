/**
 * Planning Center tool — REST API integration.
 *
 * All functions are read-only. The agent never writes to Planning Center.
 * Planning Center's API is JSONAPI-compliant with offset-based pagination.
 */

import type { Tool } from '@coki/shared';
import type { ToolOutcome } from './types';
import { ok, err } from './types';

const PC_BASE = 'https://api.planningcenteronline.com';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface PCService {
  id: string;
  serviceType: string;
  title: string;
  date: string;
  time: string;
}

export interface PCPerson {
  id: string;
  name: string;
  status: 'C' | 'U' | 'D' | '' | string; // Confirmed, Unconfirmed, Declined, empty
}

export interface PCTeam {
  id: string;
  name: string;
  scheduledPeople: PCPerson[];
  confirmedCount: number;
  unconfirmedCount: number;
}

export interface PCUnfilledPosition {
  serviceId: string;
  serviceDate: string;
  serviceTitle: string;
  teamName: string;
  quantity: number;
}

export interface PCEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  registrationCount: number;
  capacity: number | null;
}

export interface PCGroup {
  id: string;
  name: string;
  memberCount: number;
  lastActivity: string | null;
}

export interface PCPeopleSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
}

// ─── Tool definitions (LLM-facing) ────────────────────────────────────────────

export const planningCenterTools: Tool[] = [
  {
    name: 'get_upcoming_services',
    description: 'Returns upcoming services from Planning Center (next 7 days by default).',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days ahead to look (default: 7)' },
      },
    },
  },
  {
    name: 'get_service_teams',
    description: 'Returns volunteer team assignments for a specific Planning Center service plan.',
    input_schema: {
      type: 'object',
      properties: {
        service_type_id: { type: 'string', description: 'Planning Center service type ID' },
        plan_id: { type: 'string', description: 'Planning Center plan (service) ID' },
      },
      required: ['service_type_id', 'plan_id'],
    },
  },
  {
    name: 'get_unfilled_positions',
    description: 'Returns all volunteer positions across upcoming services that have no one scheduled. Critical for weekly volunteer briefings.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_upcoming_events',
    description: 'Returns upcoming events from the Planning Center Registrations module (next 14 days by default).',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days ahead to look (default: 14)' },
      },
    },
  },
  {
    name: 'get_groups_activity',
    description: 'Returns a summary of recent group activity from Planning Center Groups module.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_people',
    description: 'Search for people in Planning Center by name.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name to search for' },
      },
      required: ['query'],
    },
  },
];

// ─── HTTP helper ──────────────────────────────────────────────────────────────

interface JsonApiResponse<T> {
  data: T;
  meta?: { total_count?: number; count?: number };
  included?: unknown[];
}

async function pcGet<T>(
  accessToken: string,
  path: string,
  params: Record<string, string | number> = {},
): Promise<JsonApiResponse<T>> {
  const url = new URL(`${PC_BASE}${path}`);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, String(val));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Planning Center API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<JsonApiResponse<T>>;
}

/** Fetches all pages of a resource up to maxPages, concatenating `data` arrays. */
async function pcGetAll<T extends { id: string }>(
  accessToken: string,
  path: string,
  params: Record<string, string | number> = {},
  maxPages = 5,
): Promise<T[]> {
  const perPage = 100;
  let offset = 0;
  let total = Infinity;
  const results: T[] = [];

  for (let page = 0; page < maxPages && results.length < total; page++) {
    const res = await pcGet<T[]>(accessToken, path, { ...params, per_page: perPage, offset });
    const rows = Array.isArray(res.data) ? res.data : [];
    results.push(...rows);
    total = res.meta?.total_count ?? rows.length;
    if (rows.length < perPage) break;
    offset += perPage;
  }

  return results;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

// PC API attribute types (partial — we only declare what we use)

interface PCServiceTypeAttrs { name: string }
interface PCServiceTypeResource { id: string; attributes: PCServiceTypeAttrs }

interface PCPlanAttrs {
  title: string | null;
  dates: string;
  sort_date: string;
  service_time_name: string | null;
  series_title: string | null;
}
interface PCPlanResource { id: string; attributes: PCPlanAttrs }

interface PCTeamResource { id: string; attributes: { name: string } }

interface PCTeamMemberAttrs {
  name: string;
  status: string;
  team_position_name: string | null;
}
interface PCTeamMemberResource { id: string; attributes: PCTeamMemberAttrs }

interface PCNeededPositionAttrs { quantity: number; team_name: string }
interface PCNeededPositionResource { id: string; attributes: PCNeededPositionAttrs }

interface PCEventAttrs {
  name: string;
  starts_at: string;
  ends_at: string | null;
  registration_count: number | null;
  capacity: number | null;
}
interface PCEventResource { id: string; attributes: PCEventAttrs }

interface PCGroupAttrs {
  name: string;
  memberships_count: number;
  updated_at: string;
}
interface PCGroupResource { id: string; attributes: PCGroupAttrs }

interface PCPersonAttrs {
  name: string;
  status: string;
  emails?: Array<{ address: string; primary: boolean }>;
  phone_numbers?: Array<{ number: string; primary: boolean }>;
}
interface PCPersonResource { id: string; attributes: PCPersonAttrs }

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch upcoming services from the Services module.
 *
 * @param accessToken  Planning Center OAuth access token.
 * @param days         Look-ahead window in days (default 7).
 */
export async function getUpcomingServices(
  accessToken: string,
  days = 7,
): Promise<ToolOutcome<PCService[]>> {
  try {
    const serviceTypes = await pcGetAll<PCServiceTypeResource>(
      accessToken,
      '/services/v2/service_types',
    );

    const cutoff = isoDate(daysFromNow(days));
    const today = isoDate(new Date());
    const services: PCService[] = [];

    for (const st of serviceTypes) {
      const plans = await pcGetAll<PCPlanResource>(
        accessToken,
        `/services/v2/service_types/${st.id}/plans`,
        { filter: 'future', order: 'sort_date', per_page: 10 },
        1,
      );

      for (const plan of plans) {
        const sortDate = plan.attributes.sort_date?.slice(0, 10) ?? '';
        if (sortDate < today || sortDate > cutoff) continue;

        services.push({
          id: plan.id,
          serviceType: st.attributes.name,
          title: plan.attributes.title ?? plan.attributes.series_title ?? st.attributes.name,
          date: sortDate,
          time: plan.attributes.service_time_name ?? '',
        });
      }
    }

    services.sort((a, b) => a.date.localeCompare(b.date));
    return ok(services);
  } catch (e) {
    return err((e as Error).message, 'PC_ERROR');
  }
}

/**
 * Get volunteer team assignments for a specific service plan.
 *
 * @param accessToken    Planning Center OAuth access token.
 * @param serviceTypeId  Service type ID.
 * @param planId         Plan (service) ID.
 */
export async function getServiceTeams(
  accessToken: string,
  serviceTypeId: string,
  planId: string,
): Promise<ToolOutcome<PCTeam[]>> {
  try {
    const [teamsRes, membersRes] = await Promise.all([
      pcGet<PCTeamResource[]>(
        accessToken,
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/teams`,
      ),
      pcGetAll<PCTeamMemberResource>(
        accessToken,
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/team_members`,
      ),
    ]);

    const teams = Array.isArray(teamsRes.data) ? teamsRes.data : [];
    const teamMap = new Map<string, PCTeam>();

    for (const t of teams) {
      teamMap.set(t.id, { id: t.id, name: t.attributes.name, scheduledPeople: [], confirmedCount: 0, unconfirmedCount: 0 });
    }

    for (const m of membersRes) {
      // team_members may belong to any team — we group by team name since IDs aren't directly in attributes
      // Use the team_position_name to find the right team
      const teamName = m.attributes.team_position_name ?? '';
      const team = [...teamMap.values()].find((t) => m.attributes.name && t.name === teamName)
        ?? [...teamMap.values()][0];

      if (!team) continue;

      const person: PCPerson = {
        id: m.id,
        name: m.attributes.name,
        status: m.attributes.status ?? '',
      };
      team.scheduledPeople.push(person);
      if (m.attributes.status === 'C') team.confirmedCount++;
      else if (m.attributes.status === 'U') team.unconfirmedCount++;
    }

    return ok([...teamMap.values()]);
  } catch (e) {
    return err((e as Error).message, 'PC_ERROR');
  }
}

/**
 * Find volunteer positions across upcoming services that have no one scheduled.
 * Uses the `needed_positions` relationship on plans.
 *
 * @param accessToken  Planning Center OAuth access token.
 */
export async function getUnfilledPositions(
  accessToken: string,
): Promise<ToolOutcome<PCUnfilledPosition[]>> {
  try {
    const serviceTypes = await pcGetAll<PCServiceTypeResource>(
      accessToken,
      '/services/v2/service_types',
    );

    const cutoff = isoDate(daysFromNow(30));
    const today = isoDate(new Date());
    const unfilled: PCUnfilledPosition[] = [];

    for (const st of serviceTypes) {
      const plans = await pcGetAll<PCPlanResource>(
        accessToken,
        `/services/v2/service_types/${st.id}/plans`,
        { filter: 'future', order: 'sort_date', per_page: 10 },
        1,
      );

      for (const plan of plans) {
        const sortDate = plan.attributes.sort_date?.slice(0, 10) ?? '';
        if (sortDate < today || sortDate > cutoff) continue;

        try {
          const neededRes = await pcGet<PCNeededPositionResource[]>(
            accessToken,
            `/services/v2/service_types/${st.id}/plans/${plan.id}/needed_positions`,
          );

          const needed = Array.isArray(neededRes.data) ? neededRes.data : [];
          for (const pos of needed) {
            if (pos.attributes.quantity > 0) {
              unfilled.push({
                serviceId: plan.id,
                serviceDate: sortDate,
                serviceTitle: plan.attributes.title ?? plan.attributes.series_title ?? st.attributes.name,
                teamName: pos.attributes.team_name,
                quantity: pos.attributes.quantity,
              });
            }
          }
        } catch {
          // Some plans may not support needed_positions — skip gracefully
        }
      }
    }

    unfilled.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
    return ok(unfilled);
  } catch (e) {
    return err((e as Error).message, 'PC_ERROR');
  }
}

/**
 * Fetch upcoming events from the Registrations module.
 *
 * @param accessToken  Planning Center OAuth access token.
 * @param days         Look-ahead window in days (default 14).
 */
export async function getUpcomingEvents(
  accessToken: string,
  days = 14,
): Promise<ToolOutcome<PCEvent[]>> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    const events = await pcGetAll<PCEventResource>(
      accessToken,
      '/registrations/v2/events',
      { order: 'starts_at', per_page: 25 },
      2,
    );

    const now = new Date();
    const filtered = events.filter((e) => {
      const start = new Date(e.attributes.starts_at);
      return start >= now && start <= cutoff;
    });

    return ok(
      filtered.map((e) => ({
        id: e.id,
        title: e.attributes.name,
        startsAt: e.attributes.starts_at,
        endsAt: e.attributes.ends_at ?? '',
        registrationCount: e.attributes.registration_count ?? 0,
        capacity: e.attributes.capacity ?? null,
      })),
    );
  } catch (e) {
    return err((e as Error).message, 'PC_ERROR');
  }
}

/**
 * Return a summary of recent group activity.
 *
 * @param accessToken  Planning Center OAuth access token.
 */
export async function getGroupsActivity(
  accessToken: string,
): Promise<ToolOutcome<PCGroup[]>> {
  try {
    const groups = await pcGetAll<PCGroupResource>(
      accessToken,
      '/groups/v2/groups',
      { order: '-updated_at', per_page: 25 },
      1,
    );

    return ok(
      groups.map((g) => ({
        id: g.id,
        name: g.attributes.name,
        memberCount: g.attributes.memberships_count ?? 0,
        lastActivity: g.attributes.updated_at ?? null,
      })),
    );
  } catch (e) {
    return err((e as Error).message, 'PC_ERROR');
  }
}

/**
 * Search for people in Planning Center by name.
 *
 * @param accessToken  Planning Center OAuth access token.
 * @param query        Name to search for.
 */
export async function getPeopleSummary(
  accessToken: string,
  query: string,
): Promise<ToolOutcome<PCPeopleSummary[]>> {
  try {
    const res = await pcGet<PCPersonResource[]>(
      accessToken,
      '/people/v2/people',
      { 'where[search_name]': query, include: 'emails,phone_numbers', per_page: 10 },
    );

    const people = Array.isArray(res.data) ? res.data : [];

    return ok(
      people.map((p) => {
        const emails = p.attributes.emails ?? [];
        const phones = p.attributes.phone_numbers ?? [];
        return {
          id: p.id,
          name: p.attributes.name,
          email: emails.find((e) => e.primary)?.address ?? emails[0]?.address ?? null,
          phone: phones.find((ph) => ph.primary)?.number ?? phones[0]?.number ?? null,
          status: p.attributes.status,
        };
      }),
    );
  } catch (e) {
    return err((e as Error).message, 'PC_ERROR');
  }
}
