# COKI Agents

AI-powered executive assistant platform for church leaders. Connects calendar, email, and project management tools through a single conversational interface.

## Prerequisites

- Node.js 20+
- npm 10+
- A [Supabase](https://supabase.com) project
- A [Nylas](https://nylas.com) application (for email/calendar)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/coki-agents.git
cd coki-agents
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in all required values in `.env`. See `.env.example` for descriptions.

### 3. Run in development

```bash
npm run dev
```

This starts both the API server (`http://localhost:3001`) and the web app (`http://localhost:5173`) concurrently.

## Project Structure

```
coki-agents/
├── apps/
│   ├── api/          # Express + TypeScript backend
│   └── web/          # React + Vite frontend
├── packages/
│   └── shared/       # Shared TypeScript types
├── .env.example
└── README.md
```

## Workspaces

| Package | Description |
|---------|-------------|
| `@coki/api` | Express API server with agent loop, tool library, and integrations |
| `@coki/web` | React frontend with dashboard, chat UI, and onboarding flow |
| `@coki/shared` | Shared TypeScript types used by both apps |

## Build

```bash
npm run build          # Build all packages
npm run typecheck      # Type-check all packages
```

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, React Router
- **Backend:** Node.js, Express, TypeScript
- **Database:** Supabase (Postgres + Auth)
- **Email/Calendar:** Nylas API v3
- **AI:** Claude, OpenAI, Gemini, or local Ollama (user-configured)
- **SMS:** Twilio
- **Hosting:** Vercel (frontend) + Railway (backend)

## Build Order (per SPEC.md)

1. Supabase schema + auth
2. Backend skeleton (Express + routes)
3. LLM client (multi-provider)
4. Tool library (calendar, email, monday)
5. Agent loop
6. Onboarding flow
7. Dashboard + chat UI
8. Messaging channel connectors
9. Daily briefing scheduler
10. Settings + integration management
