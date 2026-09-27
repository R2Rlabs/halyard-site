// House bots: automated players, labelled as such, never passed off as people.
//
// A tournament with two rows in it looks dead, and the honest way to fix that is not invented humans.
// These are three programs with published strategies, playing the same season under the same rules
// and — importantly — through the same verification as everybody else. They cannot cheat either.
//
// The coin-flipper is the one worth watching. It picks a side at random, and over a season it will
// bleed out through fees, which is the most useful thing a leaderboard can teach anyone.

export const HOUSE = [
    { name: 'Momentum', strategy: 'momentum', blurb: 'buys what is rising, sells what is falling' },
    { name: 'Fade', strategy: 'fade', blurb: 'bets against the last move' },
    { name: 'Coin flip', strategy: 'coinflip', blurb: 'picks a side at random' },
];

const LOOKBACK_MINUTES = 30;
const HOLD_TICKS = 2;          // a bot holds for roughly two scheduled runs
const RISK = 0.05;             // 5% of its balance per trade
const LEVERAGE = 2;

// A bot's fill is the middle of a minute that has already been published, so the same verifier that
// judges a human judges these — and passes them for the same reason: the price is real.
const mid = (range) => (range.low + range.high) / 2;

export async function runBots(env, deps) {
    const { minuteRange, readPlayer, writePlayer, applyTrade, season } = deps;
    if (Date.now() < Date.parse(season.startsAt) || Date.now() >= Date.parse(season.endsAt)) return;

    // Four minutes back: late enough that every exchange has published the candle.
    const atMinute = Date.now() - 4 * 60_000;
    const nowRange = await minuteRange(env, atMinute);
    if (!nowRange || nowRange.error) return;
    const price = mid(nowRange);

    const thenRange = await minuteRange(env, atMinute - LOOKBACK_MINUTES * 60_000);
    const drift = thenRange && !thenRange.error ? price / mid(thenRange) - 1 : 0;

    for (const bot of HOUSE) {
        let player = await readPlayer(env, bot.name);
        if (!player) {
            player = {
                name: bot.name,
                secret: null,               // nothing can post as a bot: it has no secret to steal
                house: true,
                strategy: bot.strategy,
                blurb: bot.blurb,
                balance: season.startingBalance,
                trades: 0,
                best: 0,
                worst: 0,
                joinedAt: Date.now(),
            };
        }

        // Holding: close once it has been in long enough.
        if (player.open) {
            player.open.ticks = (player.open.ticks ?? 0) + 1;
            if (player.open.ticks < HOLD_TICKS) { await writePlayer(env, bot.name, player); continue; }

            const trade = {
                side: player.open.side,
                qty: player.open.qty,
                entry: player.open.entry,
                exit: price,
                collateral: player.open.collateral,
                openedAt: player.open.openedAt,
                closedAt: atMinute,
            };
            player.open = null;
            await writePlayer(env, bot.name, player);
            await applyTrade(env, bot.name, trade);
            continue;
        }

        // Flat: decide whether to take a side.
        const side = decide(bot.strategy, drift);
        if (!side) { await writePlayer(env, bot.name, player); continue; }

        const collateral = Math.min(player.balance, player.balance * RISK);
        if (collateral < 1) { await writePlayer(env, bot.name, player); continue; }

        player.open = {
            side,
            entry: price,
            openedAt: atMinute,
            collateral,
            qty: (collateral * LEVERAGE) / price,
            ticks: 0,
        };
        await writePlayer(env, bot.name, player);
    }
}

// Deliberately simple, and published, so nobody has to wonder whether the house has an edge. It does
// not: these are three ways of being wrong about the same price.
function decide(strategy, drift) {
    if (strategy === 'coinflip') return Math.random() < 0.5 ? 1 : -1;

    const moved = Math.abs(drift) > 0.001;      // a tenth of a percent over half an hour
    if (!moved) return null;

    if (strategy === 'momentum') return drift > 0 ? 1 : -1;
    if (strategy === 'fade') return drift > 0 ? -1 : 1;
    return null;
}
