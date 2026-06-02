# Investment Research Agent

An AI-powered research platform that lets analysts upload company annual reports (PDFs) and ask complex financial questions. The agent reads the report, searches for relevant data, pulls market context, and returns grounded, evidence-backed answers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `OPENAI_API_KEY` — for embeddings and agent LLM calls

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM + pgvector (for semantic search)
- AI: OpenAI GPT-4o (agent), text-embedding-3-small (embeddings)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite + Tailwind + shadcn/ui
- Build: esbuild (CJS bundle)

## Where things live

| Path | What it is |
|---|---|
| `artifacts/api-server/` | Express backend — agent logic, routes, vector store |
| `artifacts/research-agent/` | React frontend — upload UI and chat workspace |
| `artifacts/mockup-sandbox/` | UI component prototyping sandbox |
| `lib/db/` | Drizzle schema (source of truth for DB shape) |
| `lib/api-spec/` | OpenAPI spec (source of truth for API contract) |
| `lib/api-zod/` | Generated Zod schemas |
| `lib/api-client-react/` | Generated React Query hooks |

## Architecture decisions

- **RAG over full LLM context** — Annual reports are chunked and embedded into pgvector at upload time. Queries retrieve only the relevant chunks rather than stuffing the full document into the prompt, keeping costs low and answers grounded.
- **Contract-first API** — The OpenAPI spec in `lib/api-spec/` is the single source of truth. Zod schemas and React Query hooks are generated from it via Orval; never edit generated files by hand.
- **Tool-calling agent loop** — The agent orchestrates four tools (`rag_search`, `financial_metrics`, `news_search`, `summarize`) iteratively until it can compose a complete answer, exposing its reasoning steps in the UI.
- **Session persistence** — Chat history and tool call logs are stored per-session in Postgres, so research threads can be resumed.

## Product

- Upload a company's annual report PDF and get an automated executive summary with key financial metrics extracted immediately.
- Open a chat workspace and ask plain-English questions — revenue trends, risk factors, competitive positioning — backed by citations from the actual document.
- Create and manage multiple research sessions to track analysis across different companies or time periods.
