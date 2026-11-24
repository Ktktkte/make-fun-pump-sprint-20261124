# Graduation-Youth Sniper — Pump.fun Paper Sprint bot

[![Competition](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![Rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Ktktkte/make-fun-pump-sprint-20261124/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![Reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Ktktkte/make-fun-pump-sprint-20261124/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Entry for the make.fun bounty [Pump.fun Paper Sprint: Any Bot Can Win](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) — a paper-trading bot for the `agent-fun/replay/v2` pump.fun replay harness. Paper trading only: the replay uses market data, never real funds.

## Strategy

Most pump.fun coins die young and illiquid. The ones worth a quick trade are the coins that prove demand fast. This bot:

- **Enters** the first time a coin's real SOL reserve reaches **30 SOL** while the coin is at most **30 slots** old — a small fixed **0.10 SOL** stake, at most 5 open positions, never the same coin twice.
- **Takes profit** when the price rises 60% above the entry price.
- **Stops out** when the price falls 15% under the entry price.
- **Trails** once the price is 20% up: a 12% give-back from the peak sells the position.

Every decision comes from the batch data alone — no clock, no environment, no randomness — so the two grading executions produce byte-identical action logs.

## Layout

- `main.ts` — the strategy (Node 22, runs as-is with type stripping).
- `vendor/makefun-bot.ts` — the kit's `agent-fun/replay/v2` wire shim, vendored unchanged.

## Run

The harness drives the bot over stdin/stdout (NDJSON): it sends `hello`, one `batch` per slot, then `done`; the bot answers each batch with one `reply` of orders.

```sh
node main.ts < replay.ndjson
```
