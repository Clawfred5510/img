# IMG — Infinite Money Glitch 💰

Polymarket trading bot with multi-strategy signal engine, PostgreSQL persistence, and web dashboard.

## Architecture

- **Bot Engine**: Real-time BTC price feeds (Coinbase/Kraken/Binance) + Polymarket orderbook monitoring
- **Signal Engine**: Momentum (60%) + Volatility filter (20%) + Order Flow (20%) — backtest validated
- **Database**: PostgreSQL via Prisma — all trades, signals, and balance history persisted
- **API**: Express REST API for dashboard consumption
- **Dashboard**: Web portal for P&L, trade history, active positions (WIP)

## Trading Modes

- **Paper Trading**: Simulated trades with virtual balance tracking
- **Live Trading**: Real USDC trades on Polymarket via CLOB API

## Signal Strategy

| Signal | Weight | Description |
|--------|--------|-------------|
| Momentum | 60% | 90s BTC price momentum (78-83% WR) |
| Volatility | 20% | High-vol regime filter (82.5% vs 76.8% WR) |
| Order Flow | 20% | Polymarket orderbook imbalance |
| Mean Reversion | 0% | Disabled — consistently loses |
| Oracle Lag | 0% | Disabled — dead signal |

## Setup

```bash
npm install
cp .env.example .env  # Configure your keys
npx prisma db push    # Create database tables
npm run dev           # Start in dev mode
```

## API Endpoints

- `GET /health` — Bot status
- `GET /stats` — Trading statistics
- `GET /trades` — Recent trades
- `GET /signal` — Current signal computation
- `GET /market` — Active market info
- `GET /api/dashboard` — Full dashboard payload
- `GET /api/balance-history?hours=24` — Balance over time
