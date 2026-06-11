# AMS Copilot (LangGraph Monorepo) — Agent Context

> Self-contained brief for any agent picking up work in this project. Read this first.

## What this is

The **AI copilot for AMS** — a LangGraph agent + Next.js chat UI that lets users drive the AMS frontend (`../ams-frontend`) and query the AMS database (`../ams-backend`) with natural language. Output is rendered as **OpenUI Lang**, not markdown.

- Monorepo: **Turbo + npm workspaces** under `apps/*`
- Two workspaces: `apps/agents` (LangGraph backend) and `apps/web` (Next.js 15 / React 19 chat UI)
- TypeScript 5 (strict) everywhere
- Top-level entry: `langgraph.json` → `apps/agents/src/react-agent/graph.ts:graph`

## Workspaces

```
langchain-agent-chat-openrouter/
├── apps/
│   ├── agents/                                # LangGraph backend
│   │   ├── src/react-agent/
│   │   │   ├── graph.ts                       # Multi-agent graph entry (LangGraph export)
│   │   │   ├── model-config.ts                # OpenRouter / Groq provider selection
│   │   │   ├── prompts.ts                     # System prompts for each agent
│   │   │   ├── tools.ts                       # Orchestrator tools (get_current_time, …)
│   │   │   ├── frontend-tools.ts              # Form/page/navigation tools
│   │   │   ├── sql-tools.ts                   # LangChain SqlToolkit wrapper
│   │   │   ├── ams-module-contracts.ts        # AMS routes / forms / domain manifest
│   │   │   ├── ams-openui.ts                  # OpenUI helpers
│   │   │   ├── form-workflows.ts              # Field dependency / sequencing rules
│   │   │   ├── page-context-middleware.ts     # Injects live AMS UI state every step
│   │   │   ├── page-context-utils.ts
│   │   │   ├── frontend-failure-guard.ts      # Prevents duplicate form submits
│   │   │   ├── resilience.ts                  # Retry / backoff middleware
│   │   │   ├── openui-generated-prompt-middleware.ts  # Appends OpenUI syntax guide
│   │   │   ├── utils.ts
│   │   │   ├── static/
│   │   │   └── tests/  *.test.ts              # Jest tests beside source
│   │   ├── scripts/free-dev-port.mjs          # Kills whatever is holding :2024
│   │   └── package.json
│   └── web/                                   # Next.js 15 chat UI (port 3001)
│       └── src/
│           ├── app/                           # Next App Router
│           ├── components/
│           │   ├── thread/                    # Chat UI: Thread, messages, agent-inbox, todos panel,
│           │   │                              # external-ui-component, openui-message renderer
│           │   ├── icons/  ui/
│           ├── providers/
│           │   ├── Stream.tsx                 # Wraps useStream() from @langchain/langgraph-sdk
│           │   ├── Thread.tsx                 # Thread persistence
│           │   └── client.ts
│           ├── hooks/
│           └── lib/
├── patches/fix-openui-date-validation.mjs     # Postinstall patch
├── langgraph.json                             # LangGraph deployment config
├── turbo.json                                 # Turbo task graph
├── openui-playground-system-prompt.generated.txt
├── agent.md                                   # Long-form architecture guide (read for depth)
└── package.json                               # Workspace root
```

## Agent architecture (DeepAgents hierarchy)

| Agent | Role | Tool-call budget |
|---|---|---|
| `ams_copilot_orchestrator` | Parent. Classifies READ vs WRITE/UI intent and delegates | 70 (env override: `AGENT_TOOL_CALL_RUN_LIMIT`) |
| `frontend_controller` | Subagent. Drives forms, navigation, filters via the page bridge | default |
| `sql_analyst` | Subagent. Read-only SQL for analytics | 20 |

Routing rule: read-only / analytical → `sql_analyst`; UI action / write → `frontend_controller`.

## Tools

**Orchestrator (`tools.ts`)** — `get_current_time`.

**Frontend (`frontend-tools.ts`)**
- `set_form_values` — patch active form fields
- `search_form_options` — resolve dropdown IDs from AMS catalogs (**never guess option IDs — always call this first**)
- `request_form_submit` — pause for human-in-the-loop approval; the frontend renders an approval card
- `run_frontend_action` — registered browser actions: `open_form`, `navigate_to_route`, `set_list_filters`, …
- `resolve_relative_date` — "today"/"tomorrow"/etc. → `YYYY-MM-DD`
- `get_app_map` — fetch AMS module manifest

**SQL (`sql-tools.ts`)** — LangChain `SqlToolkit` (`sql_db_query`, `sql_db_schema`, `sql_db_query_checker`). Read-only.

## Middleware pipeline (every agent step, in order)

1. `modelRetryMiddleware` — exponential backoff on 5xx/429/network (`AGENT_MODEL_RETRY_*` env)
2. `pageContextMiddleware` — injects live AMS state: form schema, current values, list rows, detail page, permissions, recent activity
3. `toolCallLimitMiddleware` — hard stop at the configured limit
4. `frontendFailureGuardMiddleware` — rejects re-submits of already-completed forms (prevents duplicate writes)
5. `contextEditingMiddleware` — dynamic in-flight prompt edits
6. `openUiGeneratedPromptMiddleware` — appends the OpenUI syntax guide so every final response is valid OpenUI

## AMS domain manifest (`ams-module-contracts.ts`)

| Module | List | Detail | Create form(s) |
|---|---|---|---|
| Inspections | `/inspections` | `/inspections/{id}` | `inspection_create` |
| Locations | `/locations` | `/locations/{id}` | `location_create`, `sublocation_create` |
| Categories | `/categories` | `/categories/{id}` | `category_create`, `subcategory_create` |
| Items | `/items` | `/items/{id}` | `item_create` |
| Stock Entries | `/stock-entries` | `/stock-entries/{id}` | `stock_entry_create` |
| Stock Registers | `/stock-registers` | `/stock-registers/{id}` | `stock_register_create` |

**Inspection stages:** DRAFT → STOCK_DETAILS → CENTRAL_REGISTER → FINANCE_REVIEW → FINAL_APPROVAL.

**Form field dependencies (`form-workflows.ts`):**
- Stock Entry: `entry_type` controls which location fields appear → must be set first
- Inspection Central Register: `item` must be set before `instances` / `batches` become searchable
- Item Create: `category` must precede `subcategory`

## LLM providers (`model-config.ts`)

Selected via `AGENT_MODEL_PROVIDER`:

**OpenRouter** (default) — `ChatOpenAI` pointed at `https://openrouter.ai/api/v1`. Required attribution headers `HTTP-Referer`, `X-Title` (set from `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME`). Optional extended reasoning via `OPENROUTER_REASONING_*`.

**Groq** — `ChatOpenAI` pointed at Groq's OpenAI-compatible endpoint. `GROQ_API_KEY`, `GROQ_MODEL`.

## Frontend ↔ agent contract

The chat UI (apps/web) and the agent communicate via the LangGraph SDK stream. **Embedded mode**: when the chat UI is iframed by the AMS frontend (`../ams-frontend`), the AMS app sends `CONTEXT_UPDATE` messages over `postMessage` containing **readables** (current form schema, values, list rows, detail page, permissions, recent activity) and **actions** (registered browser ops with permission gates). `pageContextMiddleware` consumes these so the agent always sees what the user currently sees.

HITL flow:
1. Agent calls `request_form_submit` → execution pauses
2. AMS frontend renders the approval card
3. User accepts / rejects / manually submits / closes
4. Decision posted back through `copilotBridge` → resumes the agent
5. `frontendFailureGuardMiddleware` blocks re-submission of a form already marked `ok=true`

## Database (for `sql_analyst`)

Configured via env:
- `DATABASE_URL` — Postgres/MySQL/etc.
- `SQLITE_DATABASE_PATH` — defaults to `../../ams-backend/db.sqlite3` (the Django dev DB)

Connection is wired via TypeORM under the hood of LangChain's `SqlDatabase`.

## Tech stack quick reference

| Layer | Choice |
|---|---|
| Monorepo | Turbo + npm workspaces |
| Language | TypeScript 5 strict |
| Agent framework | LangGraph JS `1.x`, `deepagents` |
| LLM clients | `@langchain/openai` (against OpenRouter or Groq), `@langchain/core`, `@langchain/community`, `@langchain/classic`, `langchain` |
| Streaming | `@langchain/langgraph-sdk` |
| Frontend | Next.js `15.2.x`, React 19 |
| UI primitives | Radix (`dialog`, `avatar`, `label`, `separator`, `slot`, `switch`, `tooltip`) |
| Generative UI | `@openuidev/react-ui`, `@openuidev/react-lang` |
| Styling | Tailwind CSS 4 (PostCSS), `tailwind-merge`, `class-variance-authority`, `tailwindcss-animate` |
| Animations | `framer-motion` |
| Charts | `recharts` |
| Markdown / math (legacy paths) | `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `katex` |
| Toasts | `sonner` |
| State helpers | `nuqs`, `use-stick-to-bottom`, `next-themes` |
| Validation | `zod` v3 |
| Testing | Jest (`*.test.ts` alongside source) |

## Environment

Copy `.env.example` → `.env` and set at minimum:

```bash
AGENT_MODEL_PROVIDER=openrouter            # or "groq"
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME="LangChain Agent Chat App"

# DB (one of)
DATABASE_URL=...
SQLITE_DATABASE_PATH=../../ams-backend/db.sqlite3

AGENT_TOOL_CALL_RUN_LIMIT=70
AGENT_MODEL_RETRY_MAX_RETRIES=3
AGENT_MODEL_RETRY_INITIAL_DELAY_MS=1000
AGENT_MODEL_RETRY_BACKOFF_FACTOR=2

# Optional reasoning + tracing
OPENROUTER_REASONING_ENABLED=false
OPENROUTER_REASONING_EFFORT=medium         # low|medium|high
OPENROUTER_REASONING_MAX_TOKENS=2000
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=
```

## Commands

```bash
npm install                                # installs both workspaces; runs OpenUI date-validation patch
npm run dev                                # both: agents (LangGraph dev on :2024) + web (Next.js on :3001)
npx turbo dev --filter=agents              # just the LangGraph agent
npx turbo dev --filter=web                 # just the chat UI
npm run build                              # turbo build across workspaces
npm run lint   /  lint:fix
npm run format

# Direct LangGraph dev (inside apps/agents)
npx langgraphjs dev --port 2024 --config ../../langgraph.json
```

Local chat UI: <http://localhost:3001?apiUrl=http://localhost:2024&assistantId=agent>

## Key design rules (don't violate without reason)

- **Never guess option values.** Resolve every dropdown / FK via `search_form_options` first.
- **HITL before every write.** All form submissions go through `request_form_submit` and wait for explicit approval.
- **Live page context, not stale.** The agent receives a fresh AMS snapshot every step — assumptions from earlier steps will be wrong if the UI changed.
- **Failure guards over retries.** Duplicate-submit prevention lives in `frontendFailureGuardMiddleware`, not in the prompt.
- **OpenUI Lang for all final output.** Plain markdown / prose won't render correctly in the AMS frontend. The OpenUI guide is auto-appended to every system prompt.
- **Two LangGraph universes exist in this codebase.** This monorepo is the external chat copilot. The Django backend's `ai_assistant/` app is a separate Python-side LangGraph surface mounted at `/api/ai/` — don't confuse the two.

## Where to start, by task

| Task | Open this first |
|---|---|
| Add a new frontend action the agent can call | `frontend-tools.ts` + matching handler in `../ams-frontend/src/lib/copilot*.ts` + register in `ams-module-contracts.ts` |
| Teach the agent a new module / route | `ams-module-contracts.ts` + `prompts.ts` + frontend `copilotAppMap.ts` |
| Change form field ordering rule | `form-workflows.ts` + `form-workflows.test.ts` |
| Tune retry / rate-limit handling | `resilience.ts` + `AGENT_MODEL_RETRY_*` env |
| Swap LLM provider / model | `.env` (`AGENT_MODEL_PROVIDER` + provider-specific vars); deep config in `model-config.ts` |
| OpenUI syntax issue in agent output | `openui-generated-prompt-middleware.ts` + the generated `openui-playground-system-prompt.generated.txt` + frontend `AssistantOpenUiRenderer.tsx` |
| HITL approval misbehaving | `frontend-failure-guard.ts` (server) + frontend `lib/copilotDetachedApproval.ts` / `copilotHitlAutoResolve.ts` |
| SQL queries failing / wrong schema | `sql-tools.ts` + DB env vars + check the Django dev DB at `../ams-backend/db.sqlite3` |
| Chat UI bug | `apps/web/src/components/thread/` (`index.tsx`, `messages/`, `agent-inbox/`, `openui-message.tsx`) and `providers/Stream.tsx` |
