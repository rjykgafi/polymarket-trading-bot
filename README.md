# Polymarket Copy Trading Bot

Automated copy trading bot for Polymarket. Monitors whale wallets and copies their trades with proportional sizing and automatic take-profit.

## Quick Start

```bash
npm install
cp env.example .env
# Edit .env with your credentials
npm run build && npm run bot
```

## Configuration

### Environment (.env)

```env
PRIVATE_KEY=0xYourPrivateKey        # MetaMask private key
FUNDER_ADDRESS=0xYourTradingWallet  # Polymarket trading wallet (you can find it on your polymarket profile)
TAKE_PROFIT_PERCENT=15              # Auto-sell at +X% profit
DEBUG=false                         # Verbose error messages
```

### Trading Settings (config.json)

```json
{
  "wallets_to_track": ["0xWhale1", "0xWhale2"],
  "mode": "proportional",
  "min_stake": 3,
  "max_stake": 300
}
```

## Features

- **Copy Trading** — Monitors whale wallets, copies BUY/SELL trades
- **Proportional Sizing** — Scales trades based on your balance vs whale's
- **Auto Take-Profit** — GTC limit orders at guaranteed profit price
- **Auto-Pause** — Stops buying when balance < min_stake
- **Session Stats** — Shows P/L and balance after each trade

## How It Works

1. Bot monitors tracked wallets for new trades (5 sec polling)
2. When whale buys → bot copies with proportional size
3. When whale sells → bot sells matching position
4. When position hits +X% → places take-profit order
5. When balance too low → pauses until take-profit fills or deposit

## Finding Whale Wallets

- **Polymarket Leaderboard**: https://polymarket.com/leaderboard
- **Predictfolio**: https://predictfolio.com/

## Scripts

| Command | Description |
|---------|-------------|
| `npm run bot` | Start the bot |
| `npm run balance` | Check wallet balance |
| `npm run build` | Compile TypeScript |
| `npm run dev` | Development mode |

## Requirements

- Node.js 18+
- Polymarket account with USDC
- MetaMask wallet linked to Polymarket

## License

MIT

## Disclaimer

Trading involves substantial risk. Use at your own risk.
