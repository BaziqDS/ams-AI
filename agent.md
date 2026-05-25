# AMS Copilot Agent — Architecture & Developer Guide

## Overview

This is a monorepo containing an AI-powered copilot assistant for an **Asset Management System (AMS)**. Users interact with the copilot through natural language to manage inventory, assets, locations, inspections, maintenance, and stock. The system uses LangGraph for agent orchestration, OpenRouter or Groq as the LLM backend, and a Next.js frontend with generative UI via OpenUI.

---

## Project Structure

```
langchain-agent-chat-openrouter/
├── apps/
│   ├── agents/                     # Backend agent logic (Node.js / TypeScript)
│   │   └── src/react-agent/        # LangGraph agent implementation
│   │       ├── graph.ts            # Agent graph entry point
│   │       ├── model-config.ts     # LLM provider configuration
│   │       ├── prompts.ts          # System prompts for all agents
│   │       ├── tools.ts            # Orchestrator tools
│   │       ├── frontend-tools.ts   # Frontend controller tools
│   │       ├── sql-tools.ts        # SQL analyst tools (LangChain SqlToolkit)
│   │       ├── ams-module-contracts.ts  # AMS domain model & route contracts
│   │       ├── form-workflows.ts   # Field dependency & sequencing rules
│   │       ├── page-context-middleware.ts
│   │       ├── frontend-failure-guard.ts
│   │       └── resilience.ts
│   └── web/                        # Next.js 15 frontend (React 19)
│       └── src/
│           ├── app/                # Next.js app directory
│           ├── components/         # UI components
│           ├── providers/          # Stream and Thread context providers
│           ├── hooks/              # Custom React hooks
│           └── lib/                # Utility functions
├── langgraph.json                  # LangGraph deployment config
├── turbo.json                      # Turbo monorepo task orchestration
├── tsconfig.json                   # Shared TypeScript config (strict)
├── package.json                    # Workspace root
└── .env.example                    # Environment variable template
```

---

## Agent Architecture

### Multi-Agent Hierarchy

The agent graph (`graph.ts`) implements a hierarchical **DeepAgents** pattern with three agents:

| Agent | Role | Tool Call Limit |
|---|---|---|
| `ams_copilot_orchestrator` | Parent; classifies requests, delegates to subagents | 70 (configurable) |
| `frontend_controller` | Subagent; drives AMS page interactions (forms, navigation, filters) | default |
| `sql_analyst` | Subagent; executes read-only SQL queries for analytics | 20 |

The orchestrator decides whether a request is a **READ** (route to `sql_analyst`) or a **WRITE/UI action** (route to `frontend_controller`).

### LangGraph Entry Point

```
langgraph.json → ./apps/agents/src/react-agent/graph.ts:graph
```

Served locally with `langgraphjs dev --port 2024`.

---

## LLM Provider Configuration (`model-config.ts`)

Supports two backends, selected via `AGENT_MODEL_PROVIDER`:

**OpenRouter** (default):
- Base URL: `https://openrouter.ai/api/v1`
- Uses `ChatOpenAI` pointed at OpenRouter
- Required headers: `HTTP-Referer`, `X-Title` (for attribution)
- Optional extended reasoning: `OPENROUTER_REASONING_ENABLED`, `OPENROUTER_REASONING_EFFORT` (low/medium/high), `OPENROUTER_REASONING_MAX_TOKENS`

**Groq**:
- Uses `ChatOpenAI` pointed at Groq's OpenAI-compatible endpoint
- Configured via `GROQ_API_KEY` and `GROQ_MODEL`

---

## Tools

### Orchestrator Tools (`tools.ts`)
- `get_current_time` — Returns the current timestamp

### Frontend Controller Tools (`frontend-tools.ts`)
- `set_form_values` — Patch active form fields with resolved values
- `search_form_options` — Resolve dropdown / foreign-key values from AMS catalogs (never guess IDs)
- `request_form_submit` — Trigger HITL approval card; execution pauses until the user accepts or rejects
- `run_frontend_action` — Execute registered browser actions: `open_form`, `navigate_to_route`, `set_list_filters`, etc.
- `resolve_relative_date` — Convert relative dates ("today", "tomorrow") to `YYYY-MM-DD`
- `get_app_map` — Fetch the AMS module manifest (routes, forms, available capabilities)

### SQL Analyst Tools (`sql-tools.ts`)
- LangChain `SqlToolkit` wrapping the configured database
- Tools: `sql_db_query`, `sql_db_schema`, `sql_db_query_checker`
- Read-only; used exclusively by the `sql_analyst` subagent

---

## Middleware Pipeline

Every agent runs through the same ordered middleware stack:

1. **`modelRetryMiddleware`** — Exponential backoff on API failures (5xx, 429, network errors). Configurable via `AGENT_MODEL_RETRY_*` env vars.
2. **`pageContextMiddleware`** — Injects live AMS page state (form schema, current values, list rows, detail page, permissions, recent activity) into the model context before each step.
3. **`toolCallLimitMiddleware`** — Hard stops execution after the configured limit to prevent infinite loops.
4. **`frontendFailureGuardMiddleware`** — Detects duplicate form submissions; rejects re-submission if a form already completed with `ok=true` or if the user manually submitted/closed the form.
5. **`contextEditingMiddleware`** — Allows dynamic in-flight prompt editing.
6. **`openUiGeneratedPromptMiddleware`** — Appends the OpenUI syntax reference guide to system prompts so all final responses are valid OpenUI.

---

## AMS Domain Model (`ams-module-contracts.ts`)

| Module | List Route | Detail Pattern | Create Form(s) |
|---|---|---|---|
| Inspections | `/inspections` | `/inspections/{id}` | `inspection_create` |
| Locations | `/locations` | `/locations/{id}` | `location_create`, `sublocation_create` |
| Categories | `/categories` | `/categories/{id}` | `category_create`, `subcategory_create` |
| Items | `/items` | `/items/{id}` | `item_create` |
| Stock Entries | `/stock-entries` | `/stock-entries/{id}` | `stock_entry_create` |
| Stock Registers | `/stock-registers` | `/stock-registers/{id}` | `stock_register_create` |

### Inspection Workflow (Multi-Stage)

1. **DRAFT** — Create inspection with basic info
2. **STOCK_DETAILS** — Assign stock registers
3. **CENTRAL_REGISTER** — Link items to catalog, track quantities
4. **FINANCE_REVIEW** — Set depreciation classes
5. **FINAL_APPROVAL** — Complete workflow

### Form Field Dependencies (`form-workflows.ts`)

| Form | Dependency Rule |
|---|---|
| Stock Entry | `entry_type` must be set first (controls which location fields appear) |
| Inspection Central Register | `item` must be set before `instances`/`batches` become searchable |
| Item Create | `category` must be set before `subcategory` options are available |

---

## Human-In-The-Loop (HITL) Workflow

1. Agent prepares a form submission and calls `request_form_submit` — execution pauses.
2. Frontend displays an approval card showing the values to be submitted.
3. User **approves**, **rejects**, or manually submits/closes the form.
4. Frontend sends the decision via `postMessage` → `copilotBridge`.
5. Agent resumes with the approval or rejection result.

The `frontendFailureGuardMiddleware` prevents the agent from re-submitting a form that was already handled.

---

## Page Context Bridge

The frontend continuously sends `CONTEXT_UPDATE` messages containing:
- **Readables**: current form schema, active field values, visible list rows, detail page data, user permissions, recent activity
- **Actions**: registered browser operations with permission checks

The agent receives this context at the start of every step, giving it awareness of exactly what the user currently sees in AMS.

---

## OpenUI Contract

All final assistant responses must be valid **OpenUI** (token-efficient generative UI protocol). The system prompt includes an auto-generated OpenUI syntax guide appended by `openUiGeneratedPromptMiddleware`. Plain prose or markdown in final output is not permitted.

Available OpenUI components: `Button`, `Card`, `Stack`, `Table`, `Avatar`, `Switch`, and more from `@openuidev/react-ui`.

---

## Frontend (Next.js + React 19)

### Providers
- **`StreamProvider`** (`providers/Stream.tsx`) — Wraps `useStream()` from the LangGraph SDK; manages agent stream state, thread lifecycle, and dispatches custom events for frontend actions and HITL decisions.
- **`ThreadProvider`** (`providers/Thread.tsx`) — Manages conversation thread persistence across sessions.

### Key Components

| Component | Purpose |
|---|---|
| `Thread` | Main chat UI: message history, input form, context chips, voice input, todos panel |
| `AgentInbox` | HITL approval cards, tool call results, state transition views |
| `AssistantMessage` | Renders OpenUI responses via `@openuidev/react-ui` |
| `HumanMessage` | Displays user utterances |
| `InboxItemInput` | Accept / reject HITL decisions |
| `ThreadActionsView` | Shows results of frontend actions |
| `ToolCallTable` | Lists all tool invocations in a run |

The `Thread` component also notifies a parent iframe via `postMessage` (for embedding the copilot inside the AMS shell).

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# LLM provider: "openrouter" (default) or "groq"
AGENT_MODEL_PROVIDER="openrouter"

# OpenRouter
OPENROUTER_API_KEY=""
OPENROUTER_MODEL="openai/gpt-4o-mini"
OPENROUTER_SITE_URL="http://localhost:3000"
OPENROUTER_APP_NAME="LangChain Agent Chat App"

# OpenRouter extended reasoning (optional)
OPENROUTER_REASONING_ENABLED=false
OPENROUTER_REASONING_EFFORT="medium"       # low | medium | high
OPENROUTER_REASONING_MAX_TOKENS=2000

# Groq (if AGENT_MODEL_PROVIDER="groq")
GROQ_API_KEY=""
GROQ_MODEL=""

# Database (one of the following)
DATABASE_URL=""                             # PostgreSQL / other
SQLITE_DATABASE_PATH="../../ams-backend/db.sqlite3"

# Agent limits
AGENT_TOOL_CALL_RUN_LIMIT=70

# Retry configuration
AGENT_MODEL_RETRY_MAX_RETRIES=3
AGENT_MODEL_RETRY_INITIAL_DELAY_MS=1000
AGENT_MODEL_RETRY_BACKOFF_FACTOR=2

# LangSmith tracing (optional)
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=""
LANGCHAIN_PROJECT=""
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Start agents (LangGraph dev server on port 2024)
npx turbo dev --filter=agents

# Start web frontend (on port 3001)
npx turbo dev --filter=web

# Open the chat UI
# http://localhost:3001?apiUrl=http://localhost:2024&assistantId=agent
```

Both can also be started together with `npm run dev` from the repo root.

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Monorepo | Turbo, npm workspaces |
| Language | TypeScript 5 (strict) |
| Agent framework | LangGraph (JS), DeepAgents |
| LLM | OpenRouter or Groq via ChatOpenAI |
| Database (SQL agent) | TypeORM + SQLite or PostgreSQL |
| Frontend | Next.js 15, React 19 |
| Generative UI | OpenUI (`@openuidev/react-ui`) |
| Styling | Tailwind CSS, Radix UI |
| Streaming | `@langchain/langgraph-sdk` |
| Animations | Framer Motion |
| Toasts | Sonner |
| Markdown | react-markdown, remark-gfm |
| Testing | Jest |

---

## Key Design Decisions

- **Never guess option values.** Always call `search_form_options` to resolve dropdown IDs from the AMS catalog before setting form fields.
- **HITL before writes.** Every form submission routes through `request_form_submit` and waits for explicit human approval.
- **Live page context.** The agent receives a fresh snapshot of the current AMS page state on every step — it is never working from stale information.
- **Failure guards over retries.** Duplicate submission prevention is handled structurally in middleware, not through prompt instructions alone.
- **OpenUI for all output.** Enforced via middleware; generative UI components replace plain text responses.
