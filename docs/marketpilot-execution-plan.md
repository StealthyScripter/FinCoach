# MarketPilot AI Execution Plan

## Execution v2 checkpoint

The forex/commodity execution foundation now includes strategy validation scorecards, Level 0–5 paper autonomy controls, a typed trade lifecycle, risk precheck v2, forex and commodity sizing, signal-quality filtering, broker connection readiness, and a reduced Execution Center projection. The detailed architecture and remaining controlled-live gaps are documented in [execution-v2-architecture.md](./execution-v2-architecture.md).

Live order placement and unrestricted autonomous live trading remain disabled. Strategy verdicts and Level 5 status never authorize submission without the later supervised-live approval and explicit user-confirmation workflow.

## Controlled live readiness v3 checkpoint

The final pre-production readiness layer is documented in [controlled-live-readiness-v3.md](./controlled-live-readiness-v3.md). It adds expiring live permission gates, an 11-topic safety quiz, risk-hashed order previews, exact single-use final confirmation, sandbox-only OANDA/MetaTrader/generic REST adapter contracts, atomic emergency controls, seven-section readiness reporting, and a reduced Live Readiness panel.

Production broker submission remains absent. The running application can reach `sandbox_only` at most because its production feature boundary is hard-coded off.

## Current Baseline

The existing app is a Vite React client with an Express API shell, Drizzle schema scaffolding, shadcn/ui components, and in-memory storage. It already has academy, challenge, dashboard, profile, and reports pages, but most data is static and there is no risk, verification, proficiency, portfolio, or trade-ticket domain model yet.

## Delivery Principles

- Build paper-first and education-first. Live execution remains unavailable until explicit later phases.
- Keep research separate from execution. AI or agent outputs can propose trade tickets, but risk and verification gates must approve them before any order preview.
- Store evidence, timestamps, confidence, contradictions, risk factors, and audit events for all market explanations and trade ideas.
- Make every unlock proficiency-based instead of timeline-based.
- Prefer structured contracts in `shared/schema.ts` so client and server evolve together.

## Phase 1: MVP Domain Foundation

Goal: convert the app from a static finance dashboard into a MarketPilot MVP shell.

Implementation scope:

- Add shared contracts for learning stages, proficiency scores, research reports, verification checks, risk checks, paper portfolios, trade tickets, journal entries, and audit logs.
- Add API endpoints under `/api/marketpilot/*` for overview, learning plan, research reports, risk rules, paper portfolio, trade tickets, and journal entries.
- Seed a safe demo user in memory with Foundation Mode enabled and live trading disabled.
- Add UI views for progression gates, proficiency dashboard, verification-backed market explanations, risk controls, paper portfolio, and trade-ticket review.
- Rename user-facing brand from FinMind AI to MarketPilot AI.

Exit criteria:

- Typecheck passes.
- No live execution path exists.
- Every trade ticket displays verification and risk status.

Implemented checkpoints:

- Adaptive assessment endpoint records quiz/scenario evidence and updates proficiency scores.
- Proficiency scoring derives paper/live stage gates from current evidence instead of static labels only.
- Learn page includes an assessment form that submits quiz results and shows score deltas plus resulting stage.
- Journal review endpoint scores plan adherence, stop discipline, sizing discipline, emotional state, and lessons learned into trading-psychology proficiency evidence.
- Risk Officer now consumes journal quality and emotional mistake-pattern evidence to require cooling-off before new tickets after revenge, impulsive, overconfident, ignored-stop, or weak-sizing patterns.

## Phase 2: Research, Verification, and Paper Trading

Goal: make the paper workflow useful and auditable.

Implementation scope:

- Replace static seed data with PostgreSQL-backed repositories.
- Add database migrations for core MVP tables.
- Add market data providers behind interfaces: FRED for macro, a market data provider for quotes, and a news provider.
- Add scheduled market briefing generation with citations and freshness checks.
- Add paper order lifecycle: proposed, approved for paper, rejected, filled, monitored, closed.
- Add automatic journal creation from paper trades.
- Add risk-rule evaluation from user-configurable limits.

Exit criteria:

- Paper trades never bypass risk and verification checks.
- Research reports include source timestamps and contradiction fields.
- Audit log captures create/update/approve/reject events.

Implemented checkpoints:

- Core ingestion tables and schemas now cover normalized market prices, economic events, and news articles with source timestamps for later provider persistence.
- Read-only ingestion snapshot endpoint surfaces demo quote/news/event provider data and freshness actions for research verification.
- Scheduled-style market briefing workflow generates multi-symbol research reports with citation freshness checks, verification counts, required actions, and storage/audit persistence through the research report path.
- User-configurable risk settings now drive Risk Officer reduce/reject thresholds, loss-limit display rules, options premium caps, concentration limits, event windows, audit logging, and Trade Desk controls.
- Paper trade lifecycle now supports monitored paper-filled tickets, paper close requests, realized PnL/return calculation, post-close journal creation, close audit events, and Trade Desk close controls.

## Phase 3: Multi-Agent Intelligence and Simulation

Goal: expand beyond a single MVP feed into dedicated research and simulation engines.

Implementation scope:

- Add agent output contracts for Macro, Equity, ETF, Options, Forex, Commodities, Bonds, Portfolio Manager, Risk Officer, and Verification Agent.
- Add backtesting and scenario simulation APIs.
- Add portfolio models: 80/20, 60/40, three-fund, core-satellite, dividend income, factor, risk parity, and tactical allocation.
- Add options payoff simulation and margin/assignment education gates.
- Add event calendar and alert rules.

Exit criteria:

- Agent outputs are structured and testable.
- Risk Officer can override all other agents.
- Simulations are separated from paper trades and live execution.

Implemented checkpoints:

- Portfolio risk analytics endpoint computes VaR/CVaR, annualized volatility, beta, Sharpe/Sortino, concentration, liquidity, correlation snapshots, and required risk actions for the current paper portfolio.
- Paper-only backtesting endpoint and Simulation Lab panel evaluate allocation presets against deterministic historical-style return fixtures with drawdown, volatility, Sharpe, annual path, and required risk actions.
- Portfolio model comparison now covers beginner 80/20, 60/40, and three-fund models plus intermediate core-satellite, dividend income, factor, risk parity, and tactical allocation models.
- Evaluation benchmark suites now score research verification, risk-adjusted paper performance, behavioral learning, and agent reliability with monitoring and security implications.
- Market movement explanations now separate facts, interpretations, predictions, contradiction evidence, invalidation criteria, affected assets, source timestamps, and risk factors while preserving the existing explanation API shape.
- Verification-quality reporting now scores source freshness, evidence weighting, contradiction handling, and hallucination-risk controls across research reports and trade tickets.
- Central supervisor workflow now enforces idea -> verification -> risk -> portfolio impact -> compliance -> human approval -> execution sequencing with no autonomous execution capability.

## Phase 4: Broker Readiness Without Live Execution

Goal: prepare broker connectivity safely.

Implementation scope:

- Add broker abstraction with paper adapters first.
- Add encrypted credential storage design and vault integration.
- Add order preview flow with margin, liquidity, estimated fees, and slippage.
- Add user confirmation workflow and compliance acknowledgement.
- Add device/session/MFA requirements before broker connection.

Implemented checkpoints:

- Paper order previews are generated server-side, persisted, and audited before fills.
- Paper fills are rejected unless a matching preview exists.
- Paper fills now require an explicit compliance acknowledgement and user confirmation payload.
- Broker readiness endpoint reports paper broker readiness and blocks Interactive Brokers behind live feature, proficiency, vault, MFA, device, session, admin, and user unlock checks.
- Trade Desk displays broker readiness, vault status, MFA/device requirements, blocking actions, and live execution lock state.
- Compliance audit endpoint exposes a read-only, hash-chained evidence summary for risk evaluation, order preview, user acknowledgement, and paper fill events.
- Versioned compliance disclosure profiles now persist acknowledgement status, audit the user's acceptance statement, surface required disclosures in Trade Desk, and feed the supervised-live policy gate.
- Security posture endpoint now assesses MFA, credential vault, RBAC, session timeout, device verification, audit logs, rate limits, environment separation, and paper/live separation. Missing production controls are surfaced as warnings or failures with required actions.
- Dependency-free API rate limiting now protects `/api/*` in the current single-process app and records rate-limit events for metrics; Redis counters remain a v2 scaling task.

## v1.0 Architecture Checkpoint

Goal: make MarketPilot production-shaped without enabling live or autonomous trading.

Implemented foundations:

- Storage readiness: centralized memory/postgres selection, `DATABASE_URL` validation, storage health reporting, idempotent demo seed strategy, and rollback-safe migration notes.
- Event log: typed versioned internal events with correlation ID, causation ID, user ID, source service, timestamp, payload hash, append-only service API, query helpers, and tests.
- Provider abstraction: demo market, economic, news, filing, options, and broker provider interfaces plus provider health/capability registry for future Polygon, FRED, SEC EDGAR, Trading Economics, Reuters, and IBKR adapters.
- Agent memory: short-term, long-term, and semantic memory interfaces with dependency-free in-memory implementations and health reporting. Redis, PostgreSQL, and Qdrant can replace these behind the same contracts later.
- Observability: `/api/health`, `/api/health/storage`, `/api/health/providers`, `/api/health/security`, `/api/health/supervisor`, `/api/metrics`, `/api/marketpilot/event-log`, and `/api/marketpilot/memory/health`.
- Operator UI: Intelligence Desk now surfaces storage mode, provider readiness, event log count, memory counts, request metrics, verification quality, security posture, and supervisor workflow status.

Remaining v2.0 gaps:

- Redis-backed distributed rate limits and short-term memory.
- Real external provider adapters and credential vault integration.
- PostgreSQL-backed event log and long-term memory persistence.
- Qdrant semantic memory.
- OpenTelemetry tracing, Prometheus exporter, Grafana dashboard, Loki logs, and Sentry.
- Real Interactive Brokers paper adapter remains blocked behind execution-service isolation and human approval.

## v1.5 Institutional Analytics and AI Intelligence Foundation

Goal: add institutional-style analytics and AI intelligence foundations while live and autonomous execution remain blocked.

Implemented foundations:

- Research knowledge graph: typed nodes for research reports, market explanations, assets, trade journals, lessons, risk events, portfolio models, and agent decisions; typed edges for support, contradiction, references, causal and learning relationships; traversal helper and tests.
- Cross-asset relationship engine: deterministic rolling-correlation-style relationships across stocks, ETFs, forex, commodities, bonds, sectors, countries, and macro proxies with inverse/regime-sensitive classification and concentration warnings.
- Factor exposure engine: portfolio beta, sector exposure, growth/value, large/small, duration, inflation, currency, and commodity exposure estimates with risk contribution summaries.
- Monte Carlo engine: deterministic thousands-of-path-capable simulator with drawdown distribution, probability of loss, VaR, CVaR, worst cases, recovery estimate, and confidence bands.
- Stress test engine: 2008, COVID crash, 2022 inflation shock, oil shock, flash crash, rate spike, and regional banking crisis scenario replay.
- Options analytics: simulation-only Greeks engine for delta, gamma, theta, vega, rho, portfolio Greeks, payoff points, assignment risk, and volatility exposure. No live options execution path exists.
- Regime detection: risk-on/risk-off, inflation/disinflation, growth/recession, volatility, and rate regime classification with evidence and contradictions.
- Agent consensus: agreement, disagreement, confidence dispersion, minority opinions, conflicting evidence, consensus score, and confidence score.
- Behavioral intelligence: revenge trading, FOMO, overconfidence, position chasing, strategy hopping, loss aversion, and recency bias detection from journals and ticket outcomes.
- Proficiency graph: skill nodes, prerequisite/dependency/mastery/mistake relationships, adaptive recommendations, unlock readiness, weakness map, and strength map.
- Analytics dashboard: Intelligence Desk now surfaces knowledge graph counts, regime, consensus, behavioral score, Monte Carlo loss probability, factor warnings, stress tests, and Greeks.

Remaining v2.0 gaps:

- Replace deterministic demo analytics with provider-backed histories once paid/free external providers are configured.
- Persist knowledge graph and analytics snapshots to PostgreSQL/event log.
- Add charted analytics views for Monte Carlo bands, stress scenarios, factor exposure, and payoff curves.
- Add model validation benchmarks against historical datasets.
- Add OpenAI/LangGraph agent execution behind the supervisor boundary, still without autonomous trading.

## v2.0 Real Intelligence Infrastructure Foundation

Goal: move from dependency-free architecture to real AI/data infrastructure adapter boundaries while preserving demo fallbacks, paper-only safety, and human review.

Implemented foundations:

- AI provider layer: `AIProvider`, chat completion, embedding, and structured reasoning contracts with `DemoAIProvider` and environment-gated `OpenAIProvider`. Missing `OPENAI_API_KEY` falls back without hard failure. Responses carry prompt version, token usage, estimated cost, and safety metadata.
- Supervisor runtime layer: LangGraph-ready `SupervisorRuntime`, node, transition, state, and human approval gate contracts. The existing supervisor is adapted into graph snapshots for idea -> verification -> risk -> portfolio impact -> compliance -> human approval -> blocked execution.
- RAG foundation: document ingestion, chunking, embedding store, retrieval, citation building, and context building over existing memory and knowledge graph data. Demo retrieval returns citations, confidence, source freshness, and contradiction hints.
- Semantic memory adapter: `VectorStore`, `VectorRecord`, and `VectorSearchResult` contracts with in-memory vector search plus Qdrant-ready health/capability stub behind environment configuration.
- Cache adapter: `CacheStore`, `RateLimitStore`, and `SessionMemoryStore` contracts with in-memory cache/rate-limit/session behavior plus Redis-ready health/capability stub behind `REDIS_URL`.
- Time-series adapter: `TimeSeriesStore` for OHLCV bars, economic observations, options snapshots, ingestion metadata, freshness reporting, and range queries. Timescale-ready adapter remains disabled unless configured.
- Public provider adapters: FRED, SEC EDGAR, public market demo, and public economic calendar adapter structures with demo fallback data, freshness metadata, and capability health.
- Ingestion runner: manual scheduled-style provider orchestration with provider/asset selection, dry-run support, ingestion/failure/freshness reports, metrics-ready output, and event-log emission through `/api/marketpilot/ingestion/run`.
- Event log persistence adapter: `EventLogStore` with in-memory and PostgreSQL-ready implementations. PostgreSQL stays env-gated and does not replace the internal append-only event service unless configured later.
- AI evaluation harness: deterministic quality checks for JSON validity, schema adherence, citation coverage, unsupported-claim risk, confidence calibration, contradiction handling, risk disclosure, refusal/safety correctness, and agent consistency.
- AI-assisted research drafting: research draft generator uses OpenAI when configured and demo AI otherwise, builds RAG context, separates facts/interpretations/predictions in the requested schema, requires citations/risk/invalidation fields, and runs verification-quality checks before display approval.
- Operator UI: Intelligence Desk surfaces AI provider status, RAG readiness, vector/cache/time-series health, token usage, AI evaluation summary, and retrieval citations without enabling execution.

Safety and security implications:

- Live trading and autonomous execution remain blocked in code and surfaced in AI safety metadata.
- OpenAI, Qdrant, Redis, Timescale/PostgreSQL, FRED, and public provider integrations are environment-gated. Missing credentials or services degrade to demo or disabled health states.
- Tests use deterministic demo and in-memory implementations only; no test depends on internet access or paid APIs.
- Research drafts are human-reviewable artifacts, not executable trade instructions.

Remaining v2.5/v3.0 gaps:

- Replace provider stubs with real network clients, retry/backoff telemetry, provider quotas, and persistent ingestion job history.
- Add real OpenAI SDK calls with response validation, structured-output parsing, model policy configuration, and secured prompt/version registry.
- Add LangGraph runtime implementation behind the supervisor contracts.
- Add Qdrant, Redis, TimescaleDB, and PostgreSQL event-log implementations with migrations and integration tests.
- Add OpenTelemetry tracing, Prometheus exporter, Grafana dashboards, Loki logs, and Sentry reporting.
- Persist RAG documents, vector IDs, ingestion runs, AI evaluations, and generated research drafts to PostgreSQL with immutable audit links.
- Add richer charted operator views for ingestion freshness, retrieval quality, AI cost, and evaluation drift.

Exit criteria:

- Broker adapters cannot place live orders by default.
- Order preview is fully audited.
- Live environment requires explicit administrative and user unlocks.

## Phase 5: Supervised Live Assistance

Goal: allow human-approved live assistance for qualified users only.

Implementation scope:

- Add Interactive Brokers integration behind a disabled-by-default feature flag.
- Enforce proficiency gates for long-only, options spreads, margin, forex, and advanced automation separately.
- Add final confirmation step after broker preview.
- Add live risk dashboard and post-trade monitoring.
- Add automated journal entries after execution.

Exit criteria:

- No autonomous live trading.
- All live actions require risk approval, verification approval, broker preview, and user final confirmation.
- Audit logs are immutable from the application layer.

## Phase 6: Restricted Automation

Goal: introduce tightly bounded rule-based assistance only after strong testing.

Implementation scope:

- Add semi-automated rebalancing with small configurable limits.
- Add strategy marketplace only for paper-tested strategies.
- Add model portfolio reporting, multi-account support, and family-office style views.
- Add kill switches, cooling-off periods, and drift monitoring.

Exit criteria:

- Automation can only operate within pre-approved strategies and limits.
- Risk engine retains hard veto authority.
- User can disable automation immediately.
