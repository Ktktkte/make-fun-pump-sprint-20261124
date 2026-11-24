// SPDX-License-Identifier: MIT
//
// Graduation-Youth Sniper — a paper-trading bot for the pump.fun replay
// (protocol agent-fun/replay/v2), built for the "Pump.fun Paper Sprint:
// Any Bot Can Win" bounty.
//
// Idea in one paragraph: most pump.fun coins die young and illiquid. The
// ones worth a quick trade are the coins that prove demand fast — their
// real SOL reserve climbs to a solid level while the coin is still only a
// few slots old. The first time a coin's real reserve reaches the trigger
// level inside its youth window, buy a small fixed slice. Then manage the
// position mechanically: take profit at +60%, cut the loss at −15%, and
// once a coin is 20% up, trail it 12% off its peak so a reversal hands
// back only a slice of the gain. Everything is decided from the batch data alone —
// no clock, no environment, no randomness — so the two grading runs see
// byte-identical action logs.

import { runBot } from './vendor/makefun-bot.ts';
import type { Batch, BotState, OrderInput } from './vendor/makefun-bot.ts';

// ------------------------------------------------------------------ tuning

/** Fixed stake per entry: 0.10 SOL of the 10 SOL paper bankroll. */
const STAKE_LAMPORTS = 100_000_000n;
/** A coin proves itself once its real SOL reserve reaches 30 SOL. */
const TRIGGER_REAL_QUOTE = 30_000_000_000n;
/** ...but only while it is at most this many slots old. */
const YOUTH_SLOTS = 30;
/** Sell everything once the price rises 60% above the entry price. */
const TAKE_PROFIT_X = 1.6;
/** Sell everything once the price falls 15% under the entry price. */
const STOP_LOSS_X = 0.85;
/** The trailing stop arms once the price is 20% above the entry price... */
const TRAIL_ARM_X = 1.2;
/** ...and fires when the price gives back 12% from its peak. */
const TRAIL_GIVEBACK_X = 0.88;
/** Room for the 2-slot fill latency: accept fills up to 10% off decision price. */
const SLIPPAGE_BPS = 1000;
/** The guardrail's smallest round trip: never open under 0.01 SOL. */
const MIN_STAKE_LAMPORTS = 10_000_000n;

// ------------------------------------------------------------- bookkeeping

/** What the bot remembers about one open position. */
interface Tracked {
  /** Decision-time price (quote lamports per token unit) of the buy. */
  entryPrice: number;
  /** Best price seen since the position opened. */
  peakPrice: number;
}

/** Positions the bot manages, by mint. */
const tracked = new Map<string, Tracked>();
/** Mints the bot has already entered once; it never re-enters a mint. */
const entered = new Set<string>();

/** Spot price of a curve from its virtual reserves, as a plain ratio. */
function priceOf(vQuote: bigint, vToken: bigint): number {
  if (vToken <= 0n) return 0;
  return Number(vQuote) / Number(vToken);
}

/** True while a sell for this mint is still waiting for its fill. */
function sellPending(state: BotState, mint: string): boolean {
  for (const p of state.pending.values()) {
    if (p.order.side === 'sell' && p.order.mint === mint) return true;
  }
  return false;
}

// ---------------------------------------------------------------- strategy

function decide(state: BotState, batch: Batch): OrderInput[] {
  const orders: OrderInput[] = [];
  const slot = batch.slot;

  // Forget positions that are gone (sold, completed or flattened) and have
  // nothing still in flight, so the book only ever describes live holdings.
  for (const mint of [...tracked.keys()]) {
    if (state.positions.has(mint)) continue;
    let inFlight = false;
    for (const p of state.pending.values()) if (p.order.mint === mint) inFlight = true;
    if (!inFlight) tracked.delete(mint);
  }

  // Learn entry prices from the buy fills that landed since the last batch.
  for (const f of batch.fills) {
    if (f.status !== 'filled' || f.side !== 'buy') continue;
    const tokens = BigInt(f.token_amount);
    if (tokens <= 0n) continue;
    const price = Number(BigInt(f.quote_lamports)) / Number(tokens);
    const t = tracked.get(f.mint);
    if (t === undefined) tracked.set(f.mint, { entryPrice: price, peakPrice: price });
  }

  // ---- exits: run every open position through the three mechanical rules.
  for (const [mint, pos] of state.positions) {
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.complete) continue; // the harness closes completed curves itself
    const t = tracked.get(mint);
    if (t === undefined) continue; // a position this bot did not open; leave it to the flatten
    const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
    if (price <= 0) continue;
    if (price > t.peakPrice) t.peakPrice = price;

    const doubled = price >= t.entryPrice * TAKE_PROFIT_X;
    const stopped = price <= t.entryPrice * STOP_LOSS_X;
    const trailed =
      t.peakPrice >= t.entryPrice * TRAIL_ARM_X && price <= t.peakPrice * TRAIL_GIVEBACK_X;
    if ((doubled || stopped || trailed) && !sellPending(state, mint)) {
      orders.push({
        side: 'sell',
        mint,
        token_amount: pos.token_amount,
        max_slippage_bps: SLIPPAGE_BPS,
      });
    }
  }

  // ---- entries: the first youth graduation of each fresh coin, once only.
  const maxPositions = state.hello.caps.max_open_positions;
  for (const curve of state.curves.values()) {
    if (orders.length >= state.hello.caps.max_orders_per_batch) break;
    if (state.committedPositionCount() >= maxPositions) break;
    if (curve.complete || curve.created_slot === null) continue;
    if (entered.has(curve.mint)) continue;
    if (slot - curve.created_slot > YOUTH_SLOTS) continue;
    if (curve.real_quote_reserves < TRIGGER_REAL_QUOTE) continue;

    // One reply's buys on a mint share a size cap; keep the stake inside it
    // and never open below the guardrail's minimum round trip.
    const cap = state.maxBuyLamports(curve.mint);
    const stake = STAKE_LAMPORTS < cap ? STAKE_LAMPORTS : cap;
    if (stake < MIN_STAKE_LAMPORTS) continue;
    if (state.freeCashLamports() < stake + state.txFeeLamports()) continue;

    entered.add(curve.mint);
    const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
    if (price > 0) tracked.set(curve.mint, { entryPrice: price, peakPrice: price });
    orders.push({
      side: 'buy',
      mint: curve.mint,
      quote_lamports: stake,
      max_slippage_bps: SLIPPAGE_BPS,
    });
  }

  return orders;
}

await runBot({
  onBatch(state: BotState, batch: Batch) {
    return decide(state, batch);
  },
});
