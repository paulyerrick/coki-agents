import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import type { AuthedRequest } from '../middleware/auth';
import { runAgentLoop, pickFinalAssistant, type AgentEvent } from '../agent/loop';
import { getSupabaseAdmin } from '../lib/supabase';
import type { AgentMessage } from '@coki/shared';

const router = Router();

/**
 * Human-readable verb for a tool call, shown as a transient status chip
 * ("Reading emails…") in the assistant UI while the tool is running.
 */
function toolLabel(name: string): string {
  const map: Record<string, string> = {
    get_todays_events:       "Checking today's calendar",
    get_week_events:         "Checking this week's calendar",
    create_event:            'Creating calendar event',
    update_event:            'Updating calendar event',
    delete_event:            'Deleting calendar event',
    get_recent_emails:       'Reading recent emails',
    search_emails:           'Searching emails',
    get_email_thread:        'Reading email thread',
    draft_reply:             'Drafting a reply',
    get_boards:              'Loading project boards',
    get_board_items:         'Loading board items',
    get_overdue_items:       'Checking overdue items',
    get_critical_items:      'Checking critical items',
    get_weekly_summary:      'Summarizing the week',
    save_note:               'Saving a note',
    recall:                  'Recalling memory',
    get_recent_memories:     'Reviewing recent notes',
    get_upcoming_services:   'Checking upcoming services',
    get_service_teams:       'Checking service teams',
    get_unfilled_positions:  'Checking unfilled positions',
    get_upcoming_events:     'Checking upcoming events',
    get_groups_activity:     'Checking groups activity',
    search_people:           'Looking up people',
  };
  return map[name] ?? `Running ${name}`;
}

/**
 * Loads the user's IANA timezone from the users table, defaulting to
 * 'America/Denver' when unset or unreadable. Shared by every route that
 * invokes the agent loop.
 */
async function loadUserTimezone(userId: string): Promise<string> {
  const { data } = await getSupabaseAdmin()
    .from('users')
    .select('timezone')
    .eq('id', userId)
    .single<{ timezone: string }>();
  return data?.timezone ?? 'America/Denver';
}

// POST /agent/chat
router.post('/chat', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { message } = req.body as { message: string };

  if (!message?.trim()) {
    res.status(400).json({ error: { message: 'message is required' } });
    return;
  }

  const supabase = getSupabaseAdmin();

  const [{ data: historyRows }, userTimezone] = await Promise.all([
    supabase
      .from('agent_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    loadUserTimezone(userId),
  ]);

  const history = ((historyRows ?? []) as Pick<AgentMessage, 'role' | 'content'>[]).reverse();

  let newMessages;
  try {
    newMessages = await runAgentLoop(userId, history, message, userTimezone);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent loop failed';
    res.status(500).json({ error: { message: msg } });
    return;
  }

  const finalAssistant = pickFinalAssistant(newMessages);
  if (finalAssistant) {
    await supabase.from('agent_messages').insert([
      { user_id: userId, role: 'user' as const,      content: message,                tool_calls: null },
      { user_id: userId, role: 'assistant' as const, content: finalAssistant.content, tool_calls: finalAssistant.toolCalls ?? null },
    ]);
  }

  res.json({
    reply: finalAssistant?.content ?? '',
    messages: newMessages,
  });
});

// POST /agent/chat/stream — newline-delimited JSON stream of progress events.
// Each line is one AgentEvent plus a final { type: 'final', reply, messages }.
router.post('/chat/stream', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { message } = req.body as { message: string };

  if (!message?.trim()) {
    res.status(400).json({ error: { message: 'message is required' } });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const write = (event: Record<string, unknown>) => {
    res.write(JSON.stringify(event) + '\n');
  };

  const supabase = getSupabaseAdmin();

  const [{ data: historyRows }, userTimezone] = await Promise.all([
    supabase
      .from('agent_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    loadUserTimezone(userId),
  ]);

  const history = ((historyRows ?? []) as Pick<AgentMessage, 'role' | 'content'>[]).reverse();

  try {
    const newMessages = await runAgentLoop(userId, history, message, userTimezone, (event: AgentEvent) => {
      if (event.type === 'tool_start') {
        write({ type: 'tool_start', name: event.name, label: toolLabel(event.name) });
      } else if (event.type === 'tool_end') {
        write({ type: 'tool_end', name: event.name, ok: event.ok });
      } else if (event.type === 'assistant_text') {
        write({ type: 'assistant_text', content: event.content });
      } else if (event.type === 'done') {
        // 'done' is emitted AFTER the final assistant_text; we send our own
        // 'final' event below (after persistence) so the client has the full
        // payload to reconcile with.
      }
    });

    const finalAssistant = pickFinalAssistant(newMessages);
    if (finalAssistant) {
      await supabase.from('agent_messages').insert([
        { user_id: userId, role: 'user' as const,      content: message,                tool_calls: null },
        { user_id: userId, role: 'assistant' as const, content: finalAssistant.content, tool_calls: finalAssistant.toolCalls ?? null },
      ]);
    }

    write({ type: 'final', reply: finalAssistant?.content ?? '', messages: newMessages });
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent loop failed';
    write({ type: 'error', message: msg });
    res.end();
  }
});

// GET /agent/history
router.get('/history', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { data, error } = await getSupabaseAdmin()
    .from('agent_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  res.json({ messages: data ?? [] });
});

// POST /agent/briefing
router.post('/briefing', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const userTimezone = await loadUserTimezone(userId);

  let newMessages;
  try {
    newMessages = await runAgentLoop(
      userId,
      [],
      'Give me my morning briefing. Summarize my day, upcoming meetings, and any important emails.',
      userTimezone,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Briefing failed';
    res.status(500).json({ error: { message: msg } });
    return;
  }

  res.json({ briefing: newMessages.find((m) => m.role === 'assistant')?.content ?? '' });
});

export default router;
