/**
 * Tool dispatcher — routes LLM tool calls to the correct implementation.
 *
 * Each tool call arrives as { name, input } from the agent loop. This module:
 *  1. Looks up the user's integration credentials from Supabase.
 *  2. Calls the appropriate tool function with those credentials.
 *  3. Returns the ToolOutcome to be fed back into the agent loop.
 */

import { getSupabaseAdmin } from '../lib/supabase';
import { safeDecrypt } from '../lib/encryption';

import {
  getTodaysEvents,
  getWeekEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  type CreateEventInput,
} from '../tools/calendar';
import {
  getRecentEmails,
  searchEmails,
  getThread,
  draftReply,
} from '../tools/email';
import {
  getBoards,
  getBoardItems,
  getOverdueItems,
  getCriticalItems,
  getWeeklySummary,
} from '../tools/monday';
import {
  saveNote,
  recall,
  getRecentMemories,
} from '../tools/memory';
import {
  getUpcomingServices,
  getServiceTeams,
  getUnfilledPositions,
  getUpcomingEvents,
  getGroupsActivity,
  getPeopleSummary,
} from '../tools/planningcenter';
import { searchWeb, searchTwitter } from '../tools/websearch';
import type { ToolOutcome } from '../tools/types';

// ─── All tool names ───────────────────────────────────────────────────────────

export type ToolName =
  | 'get_todays_events'
  | 'get_week_events'
  | 'create_event'
  | 'update_event'
  | 'delete_event'
  | 'get_recent_emails'
  | 'search_emails'
  | 'get_email_thread'
  | 'draft_reply'
  | 'get_boards'
  | 'get_board_items'
  | 'get_overdue_items'
  | 'get_critical_items'
  | 'get_weekly_summary'
  | 'save_note'
  | 'recall'
  | 'get_recent_memories'
  | 'get_upcoming_services'
  | 'get_service_teams'
  | 'get_unfilled_positions'
  | 'get_upcoming_events'
  | 'get_groups_activity'
  | 'search_people'
  | 'search_web'
  | 'search_twitter';

// ─── Credential helpers ───────────────────────────────────────────────────────

interface NylasCredentials { grantId: string; apiKey: string }
interface MondayCredentials { apiToken: string }
interface PlanningCenterCredentials { accessToken: string }
interface UserProfile { timezone: string }

async function getNylasCredentials(
  userId: string,
  service: 'nylas_email' | 'nylas_calendar',
): Promise<NylasCredentials> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('service', service)
    .eq('status', 'connected')
    .single<{ credentials: Record<string, string> }>();

  if (error || !data) {
    throw new Error(`${service} integration is not connected for this user`);
  }
  const creds = data.credentials as Record<string, unknown>;
  return {
    grantId: safeDecrypt(creds['grantId'] ?? creds['grant_id']),
    apiKey:  safeDecrypt(creds['apiKey']  ?? creds['api_key']),
  };
}

async function getMondayCredentials(userId: string): Promise<MondayCredentials> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('service', 'monday')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, string> }>();

  if (error || !data) {
    throw new Error('Monday.com integration is not connected for this user');
  }
  return { apiToken: safeDecrypt((data.credentials as Record<string, unknown>)['apiToken']) };
}

async function getPlanningCenterCredentials(userId: string): Promise<PlanningCenterCredentials> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('service', 'planning_center')
    .eq('status', 'connected')
    .single<{ credentials: Record<string, string> }>();

  if (error || !data) {
    throw new Error('Planning Center integration is not connected for this user');
  }
  return { accessToken: safeDecrypt((data.credentials as Record<string, unknown>)['accessToken']) };
}

async function getUserProfile(userId: string): Promise<UserProfile> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('users')
    .select('timezone')
    .eq('id', userId)
    .single<{ timezone: string }>();

  if (error || !data) return { timezone: 'America/Denver' };
  return { timezone: data.timezone };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Routes a tool call from the LLM to the correct implementation.
 *
 * @param userId    Authenticated user UUID.
 * @param toolName  Tool to invoke.
 * @param input     Input arguments from the LLM tool call.
 */
export async function dispatchTool(
  userId: string,
  toolName: ToolName,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  switch (toolName) {
    // ── Calendar ──────────────────────────────────────────────────────────────
    case 'get_todays_events': {
      const [nylas, profile] = await Promise.all([
        getNylasCredentials(userId, 'nylas_calendar'),
        getUserProfile(userId),
      ]);
      return getTodaysEvents(nylas.grantId, nylas.apiKey, profile.timezone);
    }

    case 'get_week_events': {
      const [nylas, profile] = await Promise.all([
        getNylasCredentials(userId, 'nylas_calendar'),
        getUserProfile(userId),
      ]);
      return getWeekEvents(nylas.grantId, nylas.apiKey, profile.timezone);
    }

    case 'create_event': {
      const [nylas, profile] = await Promise.all([
        getNylasCredentials(userId, 'nylas_calendar'),
        getUserProfile(userId),
      ]);
      return createEvent(
        nylas.grantId,
        nylas.apiKey,
        input as unknown as CreateEventInput,
        profile.timezone,
      );
    }

    case 'update_event': {
      const [nylas, profile] = await Promise.all([
        getNylasCredentials(userId, 'nylas_calendar'),
        getUserProfile(userId),
      ]);
      return updateEvent(
        nylas.grantId,
        nylas.apiKey,
        input['event_id'] as string,
        input['fields'] as Partial<CreateEventInput>,
        profile.timezone,
      );
    }

    case 'delete_event': {
      const nylas = await getNylasCredentials(userId, 'nylas_calendar');
      return deleteEvent(nylas.grantId, nylas.apiKey, input['event_id'] as string);
    }

    // ── Email ─────────────────────────────────────────────────────────────────
    case 'get_recent_emails': {
      const nylas = await getNylasCredentials(userId, 'nylas_email');
      return getRecentEmails(
        nylas.grantId,
        nylas.apiKey,
        (input['count'] as number | undefined) ?? 10,
        input['since'] as string | undefined,
      );
    }

    case 'search_emails': {
      const nylas = await getNylasCredentials(userId, 'nylas_email');
      return searchEmails(nylas.grantId, nylas.apiKey, input['query'] as string);
    }

    case 'get_email_thread': {
      const nylas = await getNylasCredentials(userId, 'nylas_email');
      return getThread(nylas.grantId, nylas.apiKey, input['thread_id'] as string);
    }

    case 'draft_reply': {
      const nylas = await getNylasCredentials(userId, 'nylas_email');
      return draftReply(
        nylas.grantId,
        nylas.apiKey,
        input['thread_id'] as string,
        input['body'] as string,
      );
    }

    // ── Monday.com ────────────────────────────────────────────────────────────
    case 'get_boards': {
      const monday = await getMondayCredentials(userId);
      return getBoards(monday.apiToken);
    }

    case 'get_board_items': {
      const monday = await getMondayCredentials(userId);
      return getBoardItems(monday.apiToken, input['board_id'] as string);
    }

    case 'get_overdue_items': {
      const monday = await getMondayCredentials(userId);
      return getOverdueItems(monday.apiToken);
    }

    case 'get_critical_items': {
      const monday = await getMondayCredentials(userId);
      return getCriticalItems(monday.apiToken);
    }

    case 'get_weekly_summary': {
      const monday = await getMondayCredentials(userId);
      return getWeeklySummary(monday.apiToken);
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    case 'save_note':
      return saveNote(
        userId,
        input['content'] as string,
        input['tags'] as string[] | undefined,
      );

    case 'recall':
      return recall(userId, input['query'] as string);

    case 'get_recent_memories':
      return getRecentMemories(userId, (input['limit'] as number | undefined) ?? 10);

    // ── Planning Center ───────────────────────────────────────────────────────
    case 'get_upcoming_services': {
      const pc = await getPlanningCenterCredentials(userId);
      return getUpcomingServices(pc.accessToken, (input['days'] as number | undefined) ?? 7);
    }

    case 'get_service_teams': {
      const pc = await getPlanningCenterCredentials(userId);
      return getServiceTeams(
        pc.accessToken,
        input['service_type_id'] as string,
        input['plan_id'] as string,
      );
    }

    case 'get_unfilled_positions': {
      const pc = await getPlanningCenterCredentials(userId);
      return getUnfilledPositions(pc.accessToken);
    }

    case 'get_upcoming_events': {
      const pc = await getPlanningCenterCredentials(userId);
      return getUpcomingEvents(pc.accessToken, (input['days'] as number | undefined) ?? 14);
    }

    case 'get_groups_activity': {
      const pc = await getPlanningCenterCredentials(userId);
      return getGroupsActivity(pc.accessToken);
    }

    case 'search_people': {
      const pc = await getPlanningCenterCredentials(userId);
      return getPeopleSummary(pc.accessToken, input['query'] as string);
    }

    // ── Web / Twitter search (no per-user credentials needed) ─────────────────
    case 'search_web':
      return searchWeb(input['query'] as string);

    case 'search_twitter':
      return searchTwitter(input['query'] as string);

    default: {
      const _exhaustive: never = toolName;
      throw new Error(`Unknown tool: ${_exhaustive}`);
    }
  }
}
