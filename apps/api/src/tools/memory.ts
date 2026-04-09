/**
 * Memory tool — persistent agent notes stored in Supabase.
 *
 * Uses the `agent_memory` table (see supabase/schema.sql).
 * recall() leverages Postgres full-text search (no vector embeddings required).
 */

import type { Tool } from '@coki/shared';
import type { ToolOutcome } from './types';
import { ok, err } from './types';
import { getSupabaseAdmin } from '../lib/supabase';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface MemoryNote {
  id: string;
  userId: string;
  content: string;
  tags: string[];
  createdAt: string;
}

// ─── Tool definitions (LLM-facing) ────────────────────────────────────────────

export const memoryTools: Tool[] = [
  {
    name: 'save_note',
    description: 'Saves a note to the user memory for future sessions.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The note content to store' },
        tags:    {
          type:        'array',
          description: 'Optional list of topic tags (e.g. ["meeting", "follow-up"])',
          items:       { type: 'string' },
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'recall',
    description: 'Searches memory for notes relevant to a query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in memory' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_memories',
    description: 'Returns the most recently saved memory notes.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many notes to return (default 10, max 50)' },
      },
    },
  },
];

// ─── Row shape from Supabase ──────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  tags: string[];
  created_at: string;
}

function normalizeRow(row: MemoryRow): MemoryNote {
  return {
    id:        row.id,
    userId:    row.user_id,
    content:   row.content,
    tags:      row.tags ?? [],
    createdAt: row.created_at,
  };
}

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Persist a note to the user's memory store.
 *
 * @param userId   Supabase user UUID.
 * @param content  Note content to save.
 * @param tags     Optional topic tags for filtering/search.
 */
export async function saveNote(
  userId: string,
  content: string,
  tags: string[] = [],
): Promise<ToolOutcome<MemoryNote>> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agent_memory')
      .insert({ user_id: userId, content, tags })
      .select()
      .single<MemoryRow>();

    if (error) return err(error.message, 'SUPABASE_ERROR');
    return ok(normalizeRow(data));
  } catch (e) {
    return err((e as Error).message, 'UNEXPECTED_ERROR');
  }
}

/**
 * Search memory using Postgres full-text search.
 * Falls back to an ilike scan if the FTS index returns no results.
 *
 * @param userId  Supabase user UUID.
 * @param query   Free-text search query.
 */
export async function recall(
  userId: string,
  query: string,
): Promise<ToolOutcome<MemoryNote[]>> {
  try {
    const supabase = getSupabaseAdmin();

    // Primary: full-text search using the index defined in schema.sql
    const { data: ftsData, error: ftsError } = await supabase
      .from('agent_memory')
      .select('*')
      .eq('user_id', userId)
      .textSearch('content', query, { type: 'websearch', config: 'english' })
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<MemoryRow[]>();

    if (ftsError) return err(ftsError.message, 'SUPABASE_ERROR');

    // If FTS returns nothing, fall back to case-insensitive substring match
    if (!ftsData || ftsData.length === 0) {
      const { data: likeData, error: likeError } = await supabase
        .from('agent_memory')
        .select('*')
        .eq('user_id', userId)
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(20)
        .returns<MemoryRow[]>();

      if (likeError) return err(likeError.message, 'SUPABASE_ERROR');
      return ok((likeData ?? []).map(normalizeRow));
    }

    return ok(ftsData.map(normalizeRow));
  } catch (e) {
    return err((e as Error).message, 'UNEXPECTED_ERROR');
  }
}

/**
 * Return the most recently saved notes for the user.
 *
 * @param userId  Supabase user UUID.
 * @param limit   Max notes to return (default 10, capped at 50).
 */
export async function getRecentMemories(
  userId: string,
  limit: number = 10,
): Promise<ToolOutcome<MemoryNote[]>> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agent_memory')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 50))
      .returns<MemoryRow[]>();

    if (error) return err(error.message, 'SUPABASE_ERROR');
    return ok((data ?? []).map(normalizeRow));
  } catch (e) {
    return err((e as Error).message, 'UNEXPECTED_ERROR');
  }
}
