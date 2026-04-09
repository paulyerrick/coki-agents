# COKI Agents — Product Spec v0.1
## Executive Assistant (First Agent)
*COKI Studio — April 2026*

---

## Product Overview

COKI Agents is a SaaS platform for church leaders — pastors, directors, and executive staff. The first product is an Executive Assistant agent: a personal AI that manages their calendar, email, messaging, and project management tools through a single clean interface.

The user signs up, connects their tools in a self-serve onboarding flow, and immediately has a working AI assistant available through whatever messaging channel they already use (Telegram, Slack, Discord, SMS).

---

## Tech Stack

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Node.js + Express (TypeScript)
- **Database:** Supabase (Postgres + Auth)
- **AI:** User's choice — Claude API, OpenAI, Gemini, or local/open source via Ollama
- **Email/Calendar:** Nylas API v3
- **SMS:** Twilio
- **Hosting:** Vercel (frontend) + Railway (backend)

---

## Architecture

### Multi-tenant SaaS
- Each user gets their own isolated account in Supabase
- All credentials stored encrypted per user
- Agent runs per-user, never sharing context across accounts

### Agent Architecture
Each agent is a loop: Instructions → Tools → Memory → Brain (LLM)

- **Brain:** User-configured LLM (Claude, GPT-4o, Gemini, or local Ollama endpoint)
- **Tools:** Functions that connect to external APIs (Nylas, Monday, Slack, etc.)
- **Memory:** Per-user database of agent notes, past actions, and context
- **Instructions:** System prompt defining the assistant's role and constraints

### Tool Calling
Use Anthropic's tool use API pattern (works similarly across all providers). Build each integration as a typed tool function. The agent decides which tools to call.

---

## Phase 1: Executive Assistant

### What It Does

The Executive Assistant helps a church leader manage their day:

1. **Calendar awareness** — reads their calendar via Nylas, surfaces what's today and upcoming, answers "do I have time for X?"
2. **Email triage** — reads recent emails, summarizes important threads, drafts replies for approval
3. **Morning briefing** — daily summary delivered via their preferred channel at a set time
4. **Meeting prep** — given a meeting on their calendar, pulls context from email and surfaces relevant info
5. **Scheduling** — creates/updates calendar events on request
6. **Project board summary** — reads Monday.com or Asana boards and surfaces what's critical, overdue, or needs attention
7. **Natural language chat** — conversational interface through Telegram, Slack, Discord, or SMS

### Tool Library (Phase 1)

```typescript
// Calendar tools (Nylas)
get_todays_events()
get_week_events()
create_event(title, start, end, attendees?, location?)
update_event(event_id, fields)

// Email tools (Nylas)
get_recent_emails(count, since?)
search_emails(query)
get_email_thread(thread_id)
draft_reply(thread_id, body) // returns draft for human approval, never sends automatically

// Project management (Monday.com)
get_boards()
get_board_items(board_id, filter?)
get_overdue_items()
get_critical_items()

// Messaging delivery
send_message(channel, text) // delivers to user's configured channel

// Memory
save_note(text) // store something for future sessions
recall(query) // search memory for relevant context
```

### What Never Happens Automatically
- Emails never send without explicit user approval
- Calendar events never delete without confirmation
- Nothing writes to project boards without approval

---

## Onboarding Flow

5 steps, self-serve, no support call needed:

### Step 1: Account Creation
- Email + password OR Google OAuth
- Church name, role (Lead Pastor / Executive Pastor / Director / etc.)
- Time zone

### Step 2: Connect AI Provider
Choose one:
- **Claude (Anthropic)** — paste API key
- **OpenAI (GPT-4o)** — paste API key
- **Google Gemini** — paste API key
- **Local / Open Source** — paste Ollama endpoint URL (e.g. http://localhost:11434) + model name

Auto-validate: send a test ping to the API and show green/red status.

### Step 3: Connect Email & Calendar (Nylas)
- Click "Connect Microsoft Outlook" or "Connect Gmail"
- Nylas OAuth handles the auth flow
- Auto-detect calendars, user selects primary calendar
- Test: show last 3 emails and today's events to confirm connection

### Step 4: Connect Messaging Channel
Choose where the agent talks to them:
- **Telegram** — generate a bot link, user starts conversation with their personal bot
- **Slack** — connect workspace, choose DM or channel
- **Discord** — generate bot invite, choose server
- **SMS (Twilio)** — enter phone number, receive verification text

### Step 5: Optional Integrations
- **Monday.com** — paste API token + workspace ID
- **Asana** — OAuth connect
- **Twilio SMS** — (if not chosen in Step 4)

After each step: immediate validation + visual checkmark. User sees exactly what connected and what didn't.

---

## UI

### Dashboard (post-login)
- Left sidebar: Overview, Assistant, Integrations, Settings
- Center: Today's summary card (calendar, email highlights, project flags)
- Right: Chat with assistant (always visible)
- Header: Quick actions — "Brief me", "What's on my calendar?", "Check email"

### Assistant Chat
- Full conversation history
- Suggested prompts based on time of day
- Morning: "Brief me on today" / "What meetings do I have?"
- Afternoon: "What still needs attention today?"
- Evening: "What's on tomorrow?"
- Streaming responses (typewriter effect)
- Actions shown inline: "Here's a draft reply — Approve to send or Edit first"

### Integrations Page
- Card for each integration: connected/disconnected state
- One-click reconnect
- "Test connection" button per integration
- Short description of what each integration unlocks

---

## Daily Briefing (Automated)

At user-configured time (default 7AM their timezone):
- Agent pulls calendar, recent emails, project board status
- Generates 2-3 minute summary
- Converts to audio via ElevenLabs (if configured) or sends as text
- Delivers to their configured messaging channel

User can turn this off or change the time in Settings.

---

## Security & Privacy

- All API keys encrypted at rest (AES-256)
- Nylas tokens stored per-user, never logged
- No email content stored permanently — only ephemeral in-session context
- No PII sent to third-party AI if using local Ollama
- For cloud AI (Claude, GPT, Gemini): only anonymized summaries sent, never full email bodies with names (configurable)
- Each user's data fully isolated — no cross-account access

---

## File Structure

```
coki-agents/
├── apps/
│   ├── web/                    # React + Vite frontend
│   │   ├── src/
│   │   │   ├── pages/          # Dashboard, Onboarding, Settings
│   │   │   ├── components/     # ChatPanel, IntegrationCard, BriefingCard
│   │   │   └── lib/            # API client, auth hooks
│   └── api/                    # Express backend
│       ├── src/
│       │   ├── routes/         # /auth, /agent, /integrations, /webhooks
│       │   ├── tools/          # calendar.ts, email.ts, monday.ts, memory.ts
│       │   ├── agent/          # agent loop, tool dispatcher, LLM client
│       │   └── lib/            # Nylas client, Supabase client, encryption
├── packages/
│   └── shared/                 # Shared types
├── SPEC.md                     # This file
└── README.md
```

---

## Build Order

1. Supabase schema + auth
2. Backend skeleton (Express + routes)
3. LLM client (multi-provider: Claude, OpenAI, Gemini, Ollama)
4. Tool library (calendar, email, monday)
5. Agent loop (tool calling, memory, streaming)
6. Onboarding flow (frontend + API)
7. Dashboard + chat UI
8. Messaging channel connectors (Telegram first, then Slack/Discord/SMS)
9. Daily briefing scheduler
10. Settings + integration management

---

## Success Criteria for v1

A pastor signs up, connects their Outlook and Monday.com, picks Telegram as their channel, and within 15 minutes is chatting with an agent that knows their schedule, can read their email, and tells them what needs attention today — without any help from COKI Studio.

