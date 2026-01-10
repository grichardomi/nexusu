# NexusMeme Development Guide

**Last Updated**: 2026-01-04

## ⚠️ CRITICAL Policies

### 🛡️ Challenge Framework
When a user requests a change that could hurt profitability, you MUST:
1. **Challenge the premise** - Question if solution addresses real problem
2. **Cite evidence** - Reference win rates, P&L, existing successful systems
3. **Propose alternatives** - Suggest data-driven approaches
4. **Require proof** - Demand single-strategy testing before universal rollout
5. **Document anti-patterns** - Reference "Bad Ideas Hall of Shame"

**Authority**: Making money > making users feel good. Profit > politeness.

### Mission: Maximize Risk-Adjusted Return
- **Philosophy**: "Expectancy First" - Optimize profit per trade, not win rate
- Every change must improve: expectancy, profit factor, max drawdown, Sharpe ratio

**Performance Targets**:
1. **Expectancy**: >+1.0% per trade (Great: +2-3%, Good: +1-2%, Min: +0.5%)
2. **Profit Factor**: >1.5 (Great: >2.5, Good: >1.8)
3. **Max Drawdown**: <15% from peak equity
4. **Win Rate**: Strategy-specific (Trend: 35-45%, Range: 60-75%, Hybrid: 50-60%)

**Why Not Optimize Win Rate?**
- 70% WR × +0.5% avg = +0.05% expectancy (TERRIBLE)
- 40% WR × +8% avg = +1.7% expectancy (EXCELLENT)
- Expectancy × Trade Frequency = Profit

### 🎯 Test Performance = Production Performance
**CRITICAL**: Test results MUST predict production performance with zero discrepancy.
- All settings IDENTICAL except infrastructure (database location, API keys)
- Same AI thresholds, endpoints, strategy code, environment variables

### No Fake Data / No Weekend Logic / Systemic Changes Policy
- ❌ Never return fake/synthetic data - Use cache, debounce, NOT fake responses
- ❌ No weekend/time-based trading logic - Crypto trades 24/7, use regime-based logic
- ❌ NEVER make universal changes without impact analysis - Test on single strategy first

---

## 🔧 CRITICAL FIXES (2026-01-02)

**Port 8936 Analysis** - 33% win rate, -$2.98 expectancy, 0.15 profit factor

### ✅ Corrected Parameters (ALL 1h Strategies)
```typescript
// TIGHTER STOPS
stoploss: -0.015, // Was -0.04
early_loss_threshold: -0.006, // -0.6% in 3min
// LET WINNERS RUN
profit_target_weak_trend: 0.020, // 2% minimum
// STRICTER ENTRY GATES
ai_min_confidence: 68, volume_multiplier: 1.5, min_1h_momentum_pct: 1.0
// STRICTER DROPGUARD
dropguard_volume_panic_min: 1.5, // Was 2.25 (CRITICAL)
// TIGHTER EROSION CAPS
erosion_ranging: 0.95, erosion_strong_trend: 0.98
```

**Expected Impact**: Win Rate 33%→55-60%, Expectancy -2.98%→+1.5%, Profit Factor 0.15→1.8+

**Key Learnings**:
1. -4% stop TOO LOOSE for 1h (use -1.5%)
2. Volatility spike exit KILLS wins (use profit-lock ladder)
3. DropGuard 2.25× MISSES dumps (use 1.5×)
4. Cutting winners early = LOW profit factor

---

## 🚫 Bad Ideas Hall of Shame (Condensed)

**1. Weekend Bypass** - Allowed -0.3% momentum entries → 21-38% WR, -13 to -20% losses
**Lesson**: Trading more ≠ making more. Quality > quantity.

**2. Recovery Bypass** - Allowed 1h negative momentum if 4h positive → Catching falling knives
**Lesson**: Bypassing gates = catching knives.

**3. Lower AI Thresholds Globally** - 75%→50% = more trades but expectancy collapses
**Lesson**: AI confidence thresholds are profit guardrails. Keep 70-75% baseline.

**4. Major Pair Bypass** - Skipped volume validation on BTC/ETH → Flash wicks, low-liquidity dumps
**Lesson**: Blue chip assets dump just as fast.

**5. Trailing Stop on Swing** - Gave back +4% winners at +1%
**Lesson**: Wrong tool for the job. Use profit-lock ladder for swing trades.

**6. "Just Add More Indicators"** - More indicators = more conflicts = fewer entries
**Lesson**: Complexity is the enemy of profitability. Simple + AI > complex soup.

**7. Disable Stop Losses** - Small losses become catastrophic (-20%, -40%, -60%)
**Lesson**: Hope is not a strategy. Cut losers fast, let winners run.

**8. "Backtest Shows 80% Win Rate!"** - Forward test: 40-50% (overfitting)
**Lesson**: Realistic goals beat fantasy backtests. 65% that works > 80% that doesn't.

**9. "Remove AI to Save Costs"** - Win rate drops from 65-70% to 45-50%
**Lesson**: AI is investment, not expense. $50 spent for 65% WR > $0 for 50% WR.

**10. "AI Has Full Control"** - No circuit breakers, single point of failure
**Lesson**: AI is powerful, not infallible. Gates + AI > AI alone.

**11. ADX 30 Hard Gate** - Blocked 70% of trades, missed BTC 88k→90k surge
**Lesson**: ADX is LAGGING - use for regime detection (profit targets), NOT entry gate. Lowered to ADX 20.

---

## 🎯 Decision Framework

Before ANY change, answer:
1. **What problem?** - Be specific
2. **Root cause?** - Evidence-based
3. **How improve profit metrics?** - Expected impact
4. **What could go wrong?** - Risks
5. **How test?** - Single strategy first
6. **How measure success?** - Metrics
7. **Rollback plan?** - Revert path

**If you can't answer these, STOP. Challenge the change.**

---

## 📐 Operational Rules

### Entry Rules
- **AI Approval Required**: All entries (except Certainty Override)
- **Minimal Forward-Only Gates**: Leading indicators (momentum, volume, volatility)
- **Pre-Screening**: Skip AI on obvious rejects (spread >10bps, liquidity <1.0×, DropGuard)
- **Cost Control**: Cache AI (2min), coalesce requests, candle-close gating for 4h

### Exit Rules
- **Profit-Lock Ladder**: Regime-based floors (0.6% chop, 4% strong, 8% explosive) - AI CANNOT override
- **Erosion Caps**: Chop 5%, Weak 3%, Strong 2%, Explosive 2% max giveback
- **Cut Losers Fast**: -0.8% in 5min, -1.5% hard stop (1h), -4% (4h)
- **Let Winners Run**: Tiered targets, AI-gated pyramids, erosion-based exits

### Pyramiding Rules
- **When**: ADX >20, volume >1.3×, EMA alignment (lowered from ADX 30-35)
- **Where**: L1 +4%/+8%/+12% (4h), L1 +2%/+4% (1h)
- **AI Gating**: Required L2+ (confidence: L1=60%, L2=65%, L3=70%)
- **Certainty Override**: Skip AI if ADX >40, BTC >+1.5%, volume >2.5×

### Risk Controls
- **DropGuard**: Block BTC 15m <-1%, spread widening, volume panic
- **Loss Streak Cooldowns**: 3 losses = pause 2-4h
- **Daily Circuit Breaker**: Max -5% daily drawdown
- **Position Sizing**: 0.5-1% risk per trade

---

## 📁 Codebase Structure (Condensed)

```
nexusmeme/
├── pages/api/          # API routes (bot, freqtrade, ai-*, admin)
├── src/
│   ├── components/     # React components
│   ├── utils/         # Core business logic (CRITICAL FILES)
│   │   ├── UnifiedBotManager.ts         # Bot orchestration
│   │   ├── DynamicStrategyProcessor.ts  # Strategy generation
│   │   ├── StrategyPresets.ts          # SINGLE SOURCE OF TRUTH
│   │   ├── LLMStrategyEnhancer.ts       # AI integration
│   │   ├── DatabaseConnectionManager.ts # DB management
│   │   └── LeaderElection.ts           # Zero-downtime
│   ├── config/        # Configuration
│   └── services/      # External integrations
├── scripts/           # Dev & deployment scripts
├── Dockerfile.railway # Production deployment
└── CLAUDE.md         # This file
```

**Path Aliases**: `@/*` → `./src/*`, `@utils/*` → `./src/utils/*`, etc.

---

## 🏗️ Core Architecture

### Technology Stack
- Next.js 15, React 19, TypeScript, TailwindCSS
- PostgreSQL (Railway prod, Docker localhost)
- Hasura GraphQL, FreqTrade (Python), AI (OpenAI, Anthropic)
- pnpm (required)

### Key Components
1. **UnifiedBotManager**: Bot lifecycle (create, start, stop, ports 20000-39999 prod, 5000-9999 test)
2. **DynamicStrategyProcessor**: Template-based generation (AI, smart dedupe, DropGuard, pyramiding)
3. **StrategyPresets**: SINGLE SOURCE OF TRUTH (hedge_fund_envy, nexus_money_printer, capital_preservation_engine, expectancy_maximizer)
4. **LLMStrategyEnhancer**: AI validation (cost-aware prompts, triple-gate filter, calibration)
5. **LeaderElection**: Zero-downtime via PostgreSQL advisory locks (2-5s downtime)

---

## Commands & Workflows

### Dev Commands
```bash
pnpm run dev/build    # Dev server / Production build
pnpm run lint/format  # Check / Fix code style
pnpm run test/test:ci # Watch / CI mode
pnpm run type-check   # TypeScript validation
```

### Bot Management
```bash
pnpm run cleanup-orphaned-bots  # Clean orphaned bots
pnpm run test:leader-election   # Test leader election
```

### Production
```bash
pnpm run start:production       # Start production mode
```

---

## Core Trading Philosophy

**PRIMARY MANDATE**: MAKE MONEY - regardless of market regime

**Win-First Principles**:
1. Green = Opportunity - decide fast
2. Market-Adaptive Wins - small (chop), medium (trend), MAX (strong uptrend)
3. Never Let Profits Slip - lock gains aggressively
4. Exponential Scaling - pyramid in strong uptrends
5. Smart AI Balance - edge, NOT blocker
6. Forward Indicators Only - momentum, volume, volatility

**Market-Adaptive AI**:
- Trending (ADX ≥25): 55% threshold, pyramid enabled
- Ranging (ADX <20): 45% Range Lane, quick exits
- Weak Trend (20-25): 55% threshold, no pyramiding

**AI Confidence Lanes**: Base 50%, Green 45%, Dip 40%, Weekend -5%

**Exit Strategy**: Dynamic targets (2% weak, 5% moderate, 12% strong), max hold 14 days, profit floors +2%/+5%/+10%

**Pyramiding**: 4h (3 levels, +4%/+8%/+12%), 1h (2 levels, +2%/+4%), AI-gated L2+

---

## 🎯 Win-Focused Trading Systems

**1. DropGuard** - Zero AI cost, blocks falling knives (BTC <-1%, spread widening, volume panic)

**2. Certainty Override** - Bypass AI for obvious wins (ADX >30 + BTC >+1.5% + Volume >2.5×)

**3. Tiered Pyramiding** - 1h optimization (L1 +2%, L2 +4%, erosion protection 37.5%)

**4. Profit-Lock Ladder** - Chop: 0.8-1.2%, Trend: +2%/+5%/+10%, time-prune if <0.4% in 2-4h

**5. AI Exit Optimization** - Dynamic targets are GUARANTEED exits, AI optimizes early/upside only

**6. AI-Gated Pyramiding** - Hybrid validation (technical pre-screen + AI for L2+, prevent 25-35% bad pyramids)

**7. Profit Protection Hierarchy** - Floors (+2%, +5%, +10%) > Erosion Caps (5%, 3%, 2%) > AI Exit

---

## 💰 Regime Playbook

### Regime Detection (Context, Not Gating)
**ADX Role**: Determines AI thresholds and profit targets (NOT entry permission)
- Choppy (ADX <20): 45% threshold, 0.8-2% targets, fast exits
- Weak (20-30): 55% threshold, 2-4% targets
- Strong (30-40): 70% threshold, 4-6% targets, pyramiding
- Explosive (>40): 70% threshold, 8-12% targets, aggressive pyramiding

**Entry Gates** (Hybrid - 3 Paths):
- PATH 1: Momentum >0.8% → Early entry
- PATH 2: Momentum >0.5% + ADX >20 → Trend confirmation
- PATH 3: Volume >1.3× + positive momentum → Breakout
- All paths → AI validation 70%

**ADX Context After Entry**: Determines profit targets, erosion caps, pyramiding eligibility

---

## Environment & Database

### Environment Separation
**Localhost**: Docker PostgreSQL, `test_bot_instances/`, ports 5000-9999, schemas `bot_testscripts_{strategy}`
**Production**: Railway PostgreSQL, `bot_instances/`, ports 20000-39999, schemas `bot_{user.alt_id}`

### Database Architecture
- Railway PostgreSQL: 20,000+ bots via schema isolation, 94% cost savings
- FreqTrade auto-creates tables (trades, orders, pairlocks) - we don't create manually
- Connection: `RAILWAY_ENVIRONMENT=true` OR `NODE_ENV=production` → Railway DB

---

## 🎯 Smart Dedupe System

**Purpose**: Replace fixed cooldowns with intelligent signal differentiation

**How It Works**:
1. Same-candle block - prevent churning
2. Recent entry filter - block <10-15min UNLESS stronger signal
3. Override triggers - volume ≥1.8×, ADX +5, BB expansion 25%, BTC +1%
4. Signal context tracking - store volume_ratio, ADX, confidence

**Config**: `entry_cooldown: 0`, `HOURLY_TRADE_LIMIT: 0`, `max_daily_trades: 0`, `MAX_CONCURRENT_PER_PAIR: 1`

---

## 💰 AI Systems

### Cost-Aware AI (Phase 1)
- Execution Cost Calculator: Fees + spread + slippage
- Triple Gates: Cost Floor (3× costs), Risk-Reward (≥2:1), Net Edge (positive)
- Impact: Blocks 30-50% low-edge trades

### AI Calibration (Phase 2B)
- Isotonic Regression: Maps raw confidence → actual win probability
- Adjusts thresholds per timeframe for target 55% win rate
- Zero API costs (DB + math only)

### Cost Optimization
**Localhost**: 1hr cache, gpt-4o-mini, 90-95% savings
**Production**: 2min cache, gpt-4o, balanced quality/speed
**Candle-Close Gating**: 4h strategies validate at close (75% reduction)

---

## Deployment Architecture

### Single-Service Architecture
- Both localhost/production run `UnifiedBotManager` in web service
- **AUTO-START ENABLED**: Bots restart on server startup
- Config: `USE_BOT_SERVICE=false`, `BOT_SERVICE_PROXY_MODE=false`

### Railway Zero-Downtime
- Multi-instance (2-3), leader election (PostgreSQL advisory locks)
- Auto-start on leader promotion, 2-5s downtime during deployments
- Health checks `/api/health`, restart policy `ON_FAILURE`

### Multi-Shard Scaling (500+ Bots)
- **Database**: Single PostgreSQL, 20,000+ schemas
- **Runtime**: User-based sharding (5 shards = 250-500 bots, 10 shards = 500-1000 bots)
- **Implementation**: ShardManager (hash-based assignment), ShardGuard (API protection), DB-backed port allocation
- **Scaling**: $20/mo per shard, 92% margin at scale

**Recent Changes**:
- **2025-12-31**: Multi-shard port collision prevention (DB constraint + retry logic)
- **2025-12-31**: Client-side auto-start trigger (dashboard detects status="running"/"error")
- **2025-12-27**: Multi-shard architecture (ShardManager, ShardGuard, linear scaling)
- **2025-12-09**: Railway auto-start fix (startup script triggers via curl)
- **2025-11-24**: Auto-start enabled (dev/prod parity)

### Key Env Variables
```bash
RAILWAY_ENVIRONMENT=false (localhost) / true (Railway)
ENABLE_LEADER_ELECTION=false (localhost) / true (Railway)
USE_BOT_SERVICE=false (both, required)
PERSIST_BELOW_THRESHOLD=true (required)
AI_TRADE_DECISIONS_MODEL=gpt-4o-mini
SHARD_ID / SHARD_TOTAL (multi-shard only)
```

---

## 🧪 Testing & Development

### Local Setup
1. Node.js 20+, pnpm 8+, Docker
2. Start PostgreSQL: `docker-compose up -d postgres`
3. Set `.env`: `NODE_ENV=development`, `RAILWAY_ENVIRONMENT=false`
4. Start: `pnpm install && pnpm run dev`

### Test Bots vs Production
- **Test**: `test_bot_instances/`, 5000-9999, `bot_testscripts_{strategy}`, http://localhost:3000/test-scripts-monitor
- **Production**: `bot_instances/`, 20000-39999, `bot_{user.alt_id}`, production dashboard

### Testing Workflows
```bash
pnpm run test                   # Unit tests
pnpm run test:integration       # Integration tests
pnpm run cleanup-orphaned-bots  # Cleanup
```

### Parity Protocol
1. Create test bot via test-scripts-monitor
2. Create production bot with same strategy
3. Compare: parameters, execution, AI results, metrics

---

## ✅ Best Practices

### Development
- Use pnpm exclusively, never commit .env, test locally first
- Use test bots for development, run type-check before commits
- Format with Prettier: `pnpm run format`

### Code Modifications
- **NEVER modify individual strategy files** - Update `StrategyPresets.ts`
- Always use path aliases, focus on long strategies only
- No temporary fixes - permanent, well-tested solutions only

### Strategy Changes
- Test on single strategy first, verify no regressions
- Document changes in commit messages
- Always investigate root cause before fixes

### Common Pitfalls
❌ **DON'T**: Use npm, modify individual files, return fake data, make global changes without testing, commit .env
✅ **DO**: Use `UnifiedBotManager`, update `StrategyPresets.ts`, test locally, use path aliases, follow parity protocol

---

## 🚀 Boris Cherny Workflow (Claude Code Creator)

### Custom Commands (.claude/commands/)
- `/deploy-strategy-safely` - Safe strategy deployment workflow
- `/check-parity` - Test-production parity validation
- `/verify-ai-costs` - AI cost analysis and optimization
- `/verify-metrics` - Profitability metrics validation
- `/test-single-strategy` - Single strategy testing protocol

### Subagents (.claude/agents/)
- `strategy-validator` - Validates profitability metrics (expectancy, profit factor, drawdown)
- `parity-checker` - Ensures test-production consistency
- `database-guardian` - Prevents test-prod contamination

### Hooks (.claude/hooks/)
- `post-tool-use` - Auto-format, type-check, validate strategycode placement
- `post-edit` - File-specific validations (StrategyPresets, DynamicStrategyProcessor)
- `pre-commit-reminder` - Commit checklist and best practices

### MCP Integrations (.mcp.json)
- PostgreSQL MCP (enabled) - Direct database queries
- GitHub/Sentry/Slack MCPs (disabled, requires credentials)

### Workflow Principles
1. **Plan Mode First** - Complex features start in Plan mode
2. **Parallel Instances** - Run 5-15 Claude instances for complex work
3. **Verification Loops** - 2-3x quality improvement via testing
4. **Knowledge Base** - CLAUDE.md captures all mistakes/learnings

---

## 📖 Quick Reference

### Most Common Commands
```bash
pnpm run dev                    # Start dev server
pnpm run build                  # Build for production
pnpm run type-check            # Check TypeScript
pnpm run cleanup-orphaned-bots # Clean bots
curl localhost:3000/api/health # Health check
```

### Key Files
- `src/utils/StrategyPresets.ts` - Strategy definitions (SINGLE SOURCE)
- `src/utils/DynamicStrategyProcessor.ts` - Strategy generation
- `src/utils/UnifiedBotManager.ts` - Bot orchestration
- `src/utils/LLMStrategyEnhancer.ts` - AI validation

### Port Ranges
- Production: 20000-39999
- Test: 5000-9999
- Web: 3000 (localhost), 8080 (Railway)

### Critical Env Vars
```bash
RAILWAY_ENVIRONMENT=false (localhost) / true (Railway)
ENABLE_LEADER_ELECTION=false (localhost) / true (Railway)
USE_BOT_SERVICE=false (required)
PERSIST_BELOW_THRESHOLD=true (required)
```

---

**Document Version**: 3.0.0 (Condensed)
**Last Updated**: 2026-01-04
