/**
 * Monday.com tool — GraphQL API integration.
 *
 * All mutations (creating/updating items) are intentionally NOT exposed here.
 * The agent is read-only against project boards; write operations require a
 * separate approval step (per SPEC).
 */

import type { Tool } from '@coki/shared';
import type { ToolOutcome } from './types';
import { ok, err } from './types';

const MONDAY_API = 'https://api.monday.com/v2';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface MondayBoard {
  id: string;
  name: string;
  description?: string;
}

export interface MondayItem {
  id: string;
  boardId: string;
  boardName: string;
  name: string;
  status?: string;
  dueDate?: string;
  assignees?: string[];
  /** True when dueDate is in the past and status is not Done/Complete. */
  overdue?: boolean;
}

export interface WeeklySummary {
  totalItems: number;
  overdueItems: MondayItem[];
  criticalItems: MondayItem[];
  /** Items with a due date in the next 7 days. */
  upcomingItems: MondayItem[];
}

// ─── Tool definitions (LLM-facing) ────────────────────────────────────────────

export const mondayTools: Tool[] = [
  {
    name: 'get_boards',
    description: "Returns all Monday.com boards visible to the user's API token.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_board_items',
    description: 'Returns items on a specific Monday.com board.',
    input_schema: {
      type: 'object',
      properties: {
        board_id: { type: 'string', description: 'Monday.com board ID' },
      },
      required: ['board_id'],
    },
  },
  {
    name: 'get_overdue_items',
    description: 'Returns all items across boards that are past their due date.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_critical_items',
    description: 'Returns items marked as "Stuck" or high priority across all boards.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_weekly_summary',
    description: 'Returns a weekly project summary: overdue, critical, and upcoming items.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ─── GraphQL helper ───────────────────────────────────────────────────────────

async function gql<T>(apiToken: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      Authorization:  apiToken,
      'Content-Type': 'application/json',
      'API-Version':  '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Monday API error: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors?.length) {
    throw new Error(`Monday GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  return json.data as T;
}

// ─── Column value helpers ─────────────────────────────────────────────────────

interface ColumnValue {
  id:    string;
  text:  string;
  value: string | null;
}

function findColumn(cols: ColumnValue[], ...ids: string[]): string | undefined {
  for (const id of ids) {
    const col = cols.find((c) => c.id === id);
    if (col?.text) return col.text;
  }
  return undefined;
}

const DONE_STATUSES = new Set([
  'done', 'complete', 'completed', 'closed', 'resolved',
]);

const CRITICAL_STATUSES = new Set([
  'stuck', 'blocked', 'critical', 'urgent', 'high priority', 'high',
]);

function isOverdue(dueDate?: string, status?: string): boolean {
  if (!dueDate) return false;
  if (status && DONE_STATUSES.has(status.toLowerCase())) return false;
  return new Date(dueDate) < new Date();
}

function isCritical(status?: string): boolean {
  if (!status) return false;
  return CRITICAL_STATUSES.has(status.toLowerCase());
}

function isDueWithinDays(dueDate?: string, days = 7): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const future = new Date(now.getTime() + days * 86400 * 1000);
  return due >= now && due <= future;
}

// ─── Internal data fetcher ────────────────────────────────────────────────────

interface GqlBoards {
  boards: Array<{
    id: string;
    name: string;
    description: string | null;
    items_page: {
      items: Array<{
        id: string;
        name: string;
        column_values: ColumnValue[];
      }>;
    };
  }>;
}

const BOARDS_QUERY = /* graphql */ `
  query GetBoardsAndItems {
    boards(limit: 30, order_by: used_at) {
      id
      name
      description
      items_page(limit: 200) {
        items {
          id
          name
          column_values(ids: ["status", "date4", "due_date", "timeline", "person", "owner", "priority"]) {
            id
            text
            value
          }
        }
      }
    }
  }
`;

async function fetchAllItems(apiToken: string): Promise<MondayItem[]> {
  const data = await gql<GqlBoards>(apiToken, BOARDS_QUERY);
  const items: MondayItem[] = [];

  for (const board of data.boards) {
    for (const item of board.items_page.items) {
      const cols = item.column_values;
      const status   = findColumn(cols, 'status');
      const dueDate  = findColumn(cols, 'due_date', 'date4', 'timeline') ?? undefined;
      const assignees = findColumn(cols, 'person', 'owner');

      items.push({
        id:        item.id,
        boardId:   board.id,
        boardName: board.name,
        name:      item.name,
        status,
        dueDate,
        assignees: assignees ? [assignees] : undefined,
        overdue:   isOverdue(dueDate, status),
      });
    }
  }

  return items;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Return all boards visible to the token.
 *
 * @param apiToken  Monday.com API token.
 */
export async function getBoards(apiToken: string): Promise<ToolOutcome<MondayBoard[]>> {
  try {
    const data = await gql<{ boards: Array<{ id: string; name: string; description: string | null }> }>(
      apiToken,
      /* graphql */ `query { boards(limit: 50, order_by: used_at) { id name description } }`,
    );
    return ok(
      data.boards.map((b) => ({ id: b.id, name: b.name, description: b.description ?? undefined })),
    );
  } catch (e) {
    return err((e as Error).message, 'MONDAY_ERROR');
  }
}

/**
 * Return all items on a specific board.
 *
 * @param apiToken  Monday.com API token.
 * @param boardId   Board ID to fetch items from.
 */
export async function getBoardItems(
  apiToken: string,
  boardId: string,
): Promise<ToolOutcome<MondayItem[]>> {
  try {
    const data = await gql<GqlBoards>(apiToken, /* graphql */ `
      query GetBoardItems($boardId: [ID!]) {
        boards(ids: $boardId) {
          id
          name
          description
          items_page(limit: 200) {
            items {
              id
              name
              column_values(ids: ["status", "date4", "due_date", "timeline", "person", "owner", "priority"]) {
                id
                text
                value
              }
            }
          }
        }
      }
    `, { boardId: [boardId] });

    const items: MondayItem[] = [];
    for (const board of data.boards) {
      for (const item of board.items_page.items) {
        const cols = item.column_values;
        const status  = findColumn(cols, 'status');
        const dueDate = findColumn(cols, 'due_date', 'date4', 'timeline') ?? undefined;
        const assignees = findColumn(cols, 'person', 'owner');
        items.push({
          id:        item.id,
          boardId:   board.id,
          boardName: board.name,
          name:      item.name,
          status,
          dueDate,
          assignees: assignees ? [assignees] : undefined,
          overdue:   isOverdue(dueDate, status),
        });
      }
    }

    return ok(items);
  } catch (e) {
    return err((e as Error).message, 'MONDAY_ERROR');
  }
}

/**
 * Return all items across all boards that are past their due date and not done.
 *
 * @param apiToken  Monday.com API token.
 */
export async function getOverdueItems(apiToken: string): Promise<ToolOutcome<MondayItem[]>> {
  try {
    const all = await fetchAllItems(apiToken);
    return ok(all.filter((i) => i.overdue));
  } catch (e) {
    return err((e as Error).message, 'MONDAY_ERROR');
  }
}

/**
 * Return items with a "Stuck", "Blocked", or critical-equivalent status.
 *
 * @param apiToken  Monday.com API token.
 */
export async function getCriticalItems(apiToken: string): Promise<ToolOutcome<MondayItem[]>> {
  try {
    const all = await fetchAllItems(apiToken);
    return ok(all.filter((i) => isCritical(i.status)));
  } catch (e) {
    return err((e as Error).message, 'MONDAY_ERROR');
  }
}

/**
 * Return a weekly summary: totals, overdue, critical, and upcoming items.
 *
 * @param apiToken  Monday.com API token.
 */
export async function getWeeklySummary(apiToken: string): Promise<ToolOutcome<WeeklySummary>> {
  try {
    const all = await fetchAllItems(apiToken);
    return ok({
      totalItems:    all.length,
      overdueItems:  all.filter((i) => i.overdue),
      criticalItems: all.filter((i) => isCritical(i.status)),
      upcomingItems: all.filter((i) => isDueWithinDays(i.dueDate, 7) && !i.overdue),
    });
  } catch (e) {
    return err((e as Error).message, 'MONDAY_ERROR');
  }
}
