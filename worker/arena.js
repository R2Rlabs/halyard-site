// The Arena: a play-money tournament with a leaderboard nobody can fake.
//
// The practice engine runs in the visitor's browser, so anything it reports about itself is worthless
// for ranking: a leaderboard that trusts the page is topped by whoever opens devtools first. So this
// keeps the authoritative balance itself, and it believes only two things about a submitted trade —
// the times, and the prices — which it checks against real BTC price history.
//
// The consequence is the point: to climb this table you have to invent trades that match what the
// market actually did, which is the same problem as trading well.

import { runBots as tickBots } from './bots.js';

// Seasons run one after another and the Arena works out which one it is in, so a new one opens on
// its own rather than waiting for somebody to edit a constant at the right moment.
//
// Keys are namespaced by season id, so every season starts with an empty table and the one before it
// stays readable.
export const SEASONS = [
    {
        id: 's1',
        name: 'Season one',
        startsAt: '2026-09-27T00:00:00Z',
        endsAt: '2026-10-11T00:00:00Z',
    },
    {
        // A weekend: it starts on Friday evening in Europe, Friday afternoon in the States, and ends
        // on Sunday night. Short enough that the table moves while people are watching it.
        id: 's2',
        name: 'Season two · the weekend',
        startsAt: '2026-10-16T17:00:00Z',
        endsAt: '2026-10-18T23:00:00Z',
    },
];

const RULES = {
    startingBalance: 10000,
    maxLeverage: 5,
    maxTradesPerName: 300,
    feeRate: 0.0006,
};

const within = (s, at) => at >= Date.parse(s.startsAt) && at < Date.parse(s.endsAt);

// Exported so the rollover can be tested at any clock without waiting for October.
export const seasonAt = (at) => SEASONS.find((s) => within(s, at)) ?? null;

// The season trades are accepted into. Null between seasons, which is when the Arena is closed.
const active = () => SEASONS.find((s) => within(s, Date.now())) ?? null;

// The season the board shows: the live one, else the next one due, else the last one that ran.
const shown = () => active()
    ?? SEASONS.find((s) => Date.parse(s.startsAt) > Date.now())
    ?? SEASONS[SEASONS.length - 1];

// Everything that used to read a single SEASON constant reads whichever season applies now.
const S = () => ({ ...RULES, ...shown() });
const A = () => { const s = active(); return s ? { ...RULES, ...s } : null; };

const RESERVED = new Set(['momentum', 'fade', 'coin flip', 'house', 'halyard', 'r2rlabs']);

const NAME_OK = /^[A-Za-z0-9 _.-]{2,18}$/;
const TTL = { expirationTtl: 60 * 60 * 24 * 120 };

const k = {
    player: (name) => `arena:${S().id}:player:${name.toLowerCase()}`,
    trade: (name, id) => `arena:${S().id}:trade:${name.toLowerCase()}:${id}`,
    board: () => `arena:${S().id}:board`,
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const token = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const now = () => Date.now();
const seasonOpen = () => active() !== null;

// --- price verification -------------------------------------------------------------------------

// What BTC actually did in one minute, as a low and a high.
//
// Every exchange rate-limits by IP, and a Cloudflare Worker shares its IP with the world, so asking
// on every submission fails almost immediately: Coinbase answers 429, Kraken says "too many
// requests", Binance blocks outright. Bitstamp answers, and the cache below means we ask any of them
// roughly once per minute of market time however many people are playing.
//
// Sources are tried in order and the first believable answer wins. If they all fail we say so and
// count nothing: a verification that gives up and trusts the browser is not a verification.

const PRICE_TTL = { expirationTtl: 60 * 60 * 24 * 40 };

async function grab(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'halyard-arena', Accept: 'application/json' } });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

async function fromBitstamp(minute) {
    const body = await grab(`https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=60&limit=3&start=${Math.floor(minute / 1000)}`);
    const rows = body?.data?.ohlc;
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => Number(r.timestamp) * 1000 === minute);
    if (!row) return null;
    return { low: Number(row.low), high: Number(row.high), from: 'bitstamp' };
}

async function fromCoinbase(minute) {
    const rows = await grab(`https://api.exchange.coinbase.com/products/BTC-USD/candles`
        + `?granularity=60&start=${new Date(minute).toISOString()}&end=${new Date(minute + 60000).toISOString()}`);
    if (!Array.isArray(rows)) return null;
    // [ time, low, high, open, close, volume ], newest first
    const row = rows.find((r) => Number(r[0]) * 1000 === minute);
    if (!row) return null;
    return { low: Number(row[1]), high: Number(row[2]), from: 'coinbase' };
}

async function fromKraken(minute) {
    const body = await grab(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1&since=${Math.floor(minute / 1000) - 180}`);
    const result = body?.result;
    const rows = result && Object.values(result).find(Array.isArray);
    if (!Array.isArray(rows)) return null;
    // [ time, open, high, low, close, vwap, volume, count ]
    const row = rows.find((r) => Number(r[0]) * 1000 === minute);
    if (!row) return null;
    return { low: Number(row[3]), high: Number(row[2]), from: 'kraken' };
}

async function minuteRange(env, at) {
    const minute = Math.floor(at / 60000) * 60000;
    const key = `px:${minute}`;

    const cached = await env.STATS.get(key);
    if (cached) return JSON.parse(cached);

    for (const source of [fromBitstamp, fromCoinbase, fromKraken]) {
        const range = await source(minute);
        if (range && Number.isFinite(range.low) && Number.isFinite(range.high) && range.low > 0) {
            await env.STATS.put(key, JSON.stringify(range), PRICE_TTL);
            return range;
        }
    }
    return { error: 'no price source answered for that minute' };
}

const believable = (price, range) => range && !range.error
    && price >= range.low * 0.998
    && price <= range.high * 1.002;

// --- players ------------------------------------------------------------------------------------

async function readPlayer(env, name) {
    const raw = await env.STATS.get(k.player(name));
    return raw ? JSON.parse(raw) : null;
}

async function writePlayer(env, name, player) {
    await env.STATS.put(k.player(name), JSON.stringify(player), TTL);
}

// A name belongs to the browser that claimed it. No account, no email, nothing personal — just a
// random string that browser keeps, so nobody can post scores under somebody else's name.
async function claim(env, body) {
    const name = String(body.name ?? '').trim();
    if (!NAME_OK.test(name)) {
        return json({ error: 'A name is 2 to 18 letters, numbers, spaces, dots, dashes or underscores.' }, 400);
    }
    if (RESERVED.has(name.toLowerCase())) return json({ error: 'That name belongs to a house bot.' }, 409);
    const existing = await readPlayer(env, name);
    if (existing) return json({ error: 'Somebody already has that name this season.' }, 409);

    const secret = token();
    await writePlayer(env, name, {
        name,
        secret,
        balance: S().startingBalance,
        trades: 0,
        best: 0,
        worst: 0,
        joinedAt: now(),
    });
    return json({ name, secret, balance: S().startingBalance, season: publicSeason() });
}

// --- trades -------------------------------------------------------------------------------------

// The one place a trade is judged and priced, used by people and by the house bots alike. Nothing
// reaches a balance without coming through here, which is why the bots cannot cheat either.
async function applyTrade(env, name, trade) {
    const player = await readPlayer(env, name);
    if (!player) return { error: 'Claim a name first.', status: 404 };
    if (player.trades >= S().maxTradesPerName) return { error: 'Trade limit reached for this season.', status: 429 };

    const { side, qty, entry, exit, collateral } = trade;
    const openedAt = Number(trade.openedAt);
    const closedAt = Number(trade.closedAt);

    const finite = [side, qty, entry, exit, openedAt, closedAt, collateral].every(Number.isFinite);
    if (!finite || (side !== 1 && side !== -1) || qty <= 0 || entry <= 0 || exit <= 0 || collateral <= 0) {
        return { error: 'That trade does not make sense.', status: 400 };
    }

    // Inside the season, in the right order, and not from the future.
    if (openedAt < Date.parse(S().startsAt) || closedAt > now() + 60000 || closedAt <= openedAt) {
        return { error: 'Those times are outside the season.', status: 400 };
    }

    // You cannot risk what you do not have, and you cannot exceed the leverage everyone else has.
    if (collateral > player.balance + 1e-9) return { error: 'That is more collateral than you have.', status: 400 };
    const notional = qty * entry;
    if (notional > collateral * S().maxLeverage * 1.01) {
        return { error: `That is more than ${S().maxLeverage}x.`, status: 400 };
    }

    // The same trade twice is the oldest trick there is.
    const id = `${openedAt}-${closedAt}-${Math.round(entry * 100)}`;
    if (await env.STATS.get(k.trade(name, id))) return { error: 'Already counted.', status: 409 };

    // The part that matters: both prices have to match what BTC actually did at those moments.
    const [entryRange, exitRange] = await Promise.all([minuteRange(env, openedAt), minuteRange(env, closedAt)]);
    const lookupFailed = entryRange?.error ?? exitRange?.error;
    if (lookupFailed) {
        return { error: 'Could not check the price history just now. Try again in a moment.', why: lookupFailed, status: 503 };
    }
    if (!believable(entry, entryRange)) return { error: 'That entry price is not what BTC was doing.', status: 422 };
    if (!believable(exit, exitRange)) return { error: 'That exit price is not what BTC was doing.', status: 422 };

    // We compute the result ourselves. Whatever the browser thought it made is irrelevant.
    const gross = side * qty * (exit - entry);
    const fees = notional * S().feeRate + qty * exit * S().feeRate;
    const pnl = Math.max(gross - fees, -collateral);   // never lose more than the collateral

    player.balance = Math.max(0, player.balance + pnl);
    player.trades += 1;
    // Kept so a season can be decomposed into what direction earned and what the fees took, measured
    // rather than worked back from the rule.
    player.fees = Math.round(((player.fees ?? 0) + fees) * 100) / 100;
    player.gross = Math.round(((player.gross ?? 0) + gross) * 100) / 100;
    player.best = Math.max(player.best, pnl);
    player.worst = Math.min(player.worst, pnl);
    player.lastAt = now();

    await env.STATS.put(k.trade(name, id), '1', TTL);
    await writePlayer(env, name, player);
    await touchBoard(env, player);

    return { ok: true, pnl: Math.round(pnl * 100) / 100, balance: Math.round(player.balance * 100) / 100 };
}

async function submit(env, body) {
    if (!seasonOpen()) return json({ error: 'The season is not open.' }, 403);

    const name = String(body.name ?? '').trim();
    const player = await readPlayer(env, name);
    if (!player) return json({ error: 'Claim a name first.' }, 404);
    if (player.house) return json({ error: 'That is a house bot, not a name you can play under.' }, 403);
    if (body.secret !== player.secret) return json({ error: 'That name belongs to another browser.' }, 403);

    const result = await applyTrade(env, name, {
        side: Number(body.side),
        qty: Number(body.qty),
        entry: Number(body.entry),
        exit: Number(body.exit),
        collateral: Number(body.collateral),
        openedAt: Number(body.openedAt),
        closedAt: Number(body.closedAt),
    });
    const { status = 200, ...rest } = result;
    return json(rest, result.ok ? 200 : status);
}

// --- the board ----------------------------------------------------------------------------------

// A single row per player, kept small enough to read in one request.
async function touchBoard(env, player) {
    const raw = await env.STATS.get(k.board());
    const board = raw ? JSON.parse(raw) : [];
    const row = { name: player.name, balance: Math.round(player.balance * 100) / 100, trades: player.trades };
    if (player.house) { row.house = true; row.blurb = player.blurb; }
    const at = board.findIndex((r) => r.name.toLowerCase() === player.name.toLowerCase());
    if (at >= 0) board[at] = row; else board.push(row);
    board.sort((a, b) => b.balance - a.balance);
    await env.STATS.put(k.board(), JSON.stringify(board.slice(0, 200)), TTL);
}

// What the same starting balance would be worth if you had simply bought BTC when the season opened
// and done nothing since. It is the honest way to fill a quiet leaderboard: a target everybody can
// see, obviously not a person, and the number most traders lose to without noticing.
async function holdingBtc(env) {
    if (Date.now() < Date.parse(S().startsAt)) {
        return { name: 'Holding BTC', balance: S().startingBalance, benchmark: true };
    }
    const [opened, latest] = await Promise.all([
        minuteRange(env, Date.parse(S().startsAt)),
        // A few minutes back, so the candle for that minute has certainly been published.
        minuteRange(env, Date.now() - 240000),
    ]);
    if (opened?.error || latest?.error) return null;

    const mid = (r) => (r.low + r.high) / 2;
    const balance = S().startingBalance * (mid(latest) / mid(opened));
    return {
        name: 'Holding BTC',
        balance: Math.round(balance * 100) / 100,
        benchmark: true,
        since: Math.round(mid(opened)),
    };
}

async function board(env) {
    const raw = await env.STATS.get(k.board());
    const rows = raw ? JSON.parse(raw) : [];
    return json({
        season: publicSeason(),
        players: rows.length,
        board: rows.slice(0, 50),
        benchmark: await holdingBtc(env),
    });
}

const publicSeason = () => ({
    id: S().id,
    name: S().name,
    startsAt: S().startsAt,
    endsAt: S().endsAt,
    startingBalance: S().startingBalance,
    maxLeverage: S().maxLeverage,
    open: seasonOpen(),
    // When the Arena is shut, this is the thing worth saying.
    opensAt: seasonOpen() ? null : S().startsAt,
});

async function me(env, url) {
    const name = String(url.searchParams.get('name') ?? '').trim();
    const player = await readPlayer(env, name);
    if (!player) return json({ error: 'No such name.' }, 404);
    return json({
        name: player.name,
        balance: Math.round(player.balance * 100) / 100,
        trades: player.trades,
        season: publicSeason(),
    });
}

// --- routing ------------------------------------------------------------------------------------


// Driven by the cron trigger, and by hand with the stats token when we want to watch it work.
export async function runBots(env) {
    const season = A();
    if (!season) return;   // between seasons the bots sit out too
    return tickBots(env, { minuteRange, readPlayer, writePlayer, applyTrade, season });
}

export async function arena(request, env, url) {
    const path = url.pathname;

    if (path === '/arena/board' && request.method === 'GET') return board(env);
    if (path === '/arena/me' && request.method === 'GET') return me(env, url);

    if (request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch { return json({ error: 'Expected JSON.' }, 400); }
        if (path === '/arena/claim') return claim(env, body);
        if (path === '/arena/trade') return submit(env, body);
    }

    return null;
}
