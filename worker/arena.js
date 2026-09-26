// The Arena: a play-money tournament with a leaderboard nobody can fake.
//
// The practice engine runs in the visitor's browser, so anything it reports about itself is worthless
// for ranking: a leaderboard that trusts the page is topped by whoever opens devtools first. So this
// keeps the authoritative balance itself, and it believes only two things about a submitted trade —
// the times, and the prices — which it checks against real BTC price history.
//
// The consequence is the point: to climb this table you have to invent trades that match what the
// market actually did, which is the same problem as trading well.

export const SEASON = {
    id: 's1',
    name: 'Season one',
    // Set when the season opens. Trades outside the window are refused.
    startsAt: '2026-09-26T00:00:00Z',
    endsAt: '2026-10-03T00:00:00Z',
    startingBalance: 10000,
    maxLeverage: 5,
    maxTradesPerName: 300,
    feeRate: 0.0006,
};

const NAME_OK = /^[A-Za-z0-9 _.-]{2,18}$/;
const TTL = { expirationTtl: 60 * 60 * 24 * 120 };

const k = {
    player: (name) => `arena:${SEASON.id}:player:${name.toLowerCase()}`,
    trade: (name, id) => `arena:${SEASON.id}:trade:${name.toLowerCase()}:${id}`,
    board: () => `arena:${SEASON.id}:board`,
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
const seasonOpen = () => now() >= Date.parse(SEASON.startsAt) && now() < Date.parse(SEASON.endsAt);

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
    const existing = await readPlayer(env, name);
    if (existing) return json({ error: 'Somebody already has that name this season.' }, 409);

    const secret = token();
    await writePlayer(env, name, {
        name,
        secret,
        balance: SEASON.startingBalance,
        trades: 0,
        best: 0,
        worst: 0,
        joinedAt: now(),
    });
    return json({ name, secret, balance: SEASON.startingBalance, season: publicSeason() });
}

// --- trades -------------------------------------------------------------------------------------

async function submit(env, body) {
    if (!seasonOpen()) return json({ error: 'The season is not open.' }, 403);

    const name = String(body.name ?? '').trim();
    const player = await readPlayer(env, name);
    if (!player) return json({ error: 'Claim a name first.' }, 404);
    if (body.secret !== player.secret) return json({ error: 'That name belongs to another browser.' }, 403);
    if (player.trades >= SEASON.maxTradesPerName) return json({ error: 'Trade limit reached for this season.' }, 429);

    const side = Number(body.side);
    const qty = Number(body.qty);
    const entry = Number(body.entry);
    const exit = Number(body.exit);
    const openedAt = Number(body.openedAt);
    const closedAt = Number(body.closedAt);
    const collateral = Number(body.collateral);

    const finite = [side, qty, entry, exit, openedAt, closedAt, collateral].every(Number.isFinite);
    if (!finite || (side !== 1 && side !== -1) || qty <= 0 || entry <= 0 || exit <= 0 || collateral <= 0) {
        return json({ error: 'That trade does not make sense.' }, 400);
    }

    // Inside the season, in the right order, and not from the future.
    if (openedAt < Date.parse(SEASON.startsAt) || closedAt > now() + 60000 || closedAt <= openedAt) {
        return json({ error: 'Those times are outside the season.' }, 400);
    }

    // You cannot risk what you do not have, and you cannot exceed the leverage everyone else has.
    if (collateral > player.balance + 1e-9) return json({ error: 'That is more collateral than you have.' }, 400);
    const notional = qty * entry;
    if (notional > collateral * SEASON.maxLeverage * 1.01) {
        return json({ error: `That is more than ${SEASON.maxLeverage}x.` }, 400);
    }

    // The same trade twice is the oldest trick there is.
    const id = `${openedAt}-${closedAt}-${Math.round(entry * 100)}`;
    if (await env.STATS.get(k.trade(name, id))) return json({ error: 'Already counted.' }, 409);

    // The part that matters: both prices have to match what BTC actually did at those moments.
    const [entryRange, exitRange] = await Promise.all([minuteRange(env, openedAt), minuteRange(env, closedAt)]);
    const lookupFailed = entryRange?.error ?? exitRange?.error;
    if (lookupFailed) {
        return json({ error: 'Could not check the price history just now. Try again in a moment.', why: lookupFailed }, 503);
    }
    if (!believable(entry, entryRange)) return json({ error: 'That entry price is not what BTC was doing.' }, 422);
    if (!believable(exit, exitRange)) return json({ error: 'That exit price is not what BTC was doing.' }, 422);

    // We compute the result ourselves. Whatever the browser thought it made is irrelevant.
    const gross = side * qty * (exit - entry);
    const fees = notional * SEASON.feeRate + qty * exit * SEASON.feeRate;
    const pnl = Math.max(gross - fees, -collateral);   // never lose more than the collateral

    player.balance = Math.max(0, player.balance + pnl);
    player.trades += 1;
    player.best = Math.max(player.best, pnl);
    player.worst = Math.min(player.worst, pnl);
    player.lastAt = now();

    await env.STATS.put(k.trade(name, id), '1', TTL);
    await writePlayer(env, name, player);
    await touchBoard(env, player);

    return json({ ok: true, pnl: Math.round(pnl * 100) / 100, balance: Math.round(player.balance * 100) / 100 });
}

// --- the board ----------------------------------------------------------------------------------

// A single row per player, kept small enough to read in one request.
async function touchBoard(env, player) {
    const raw = await env.STATS.get(k.board());
    const board = raw ? JSON.parse(raw) : [];
    const row = { name: player.name, balance: Math.round(player.balance * 100) / 100, trades: player.trades };
    const at = board.findIndex((r) => r.name.toLowerCase() === player.name.toLowerCase());
    if (at >= 0) board[at] = row; else board.push(row);
    board.sort((a, b) => b.balance - a.balance);
    await env.STATS.put(k.board(), JSON.stringify(board.slice(0, 200)), TTL);
}

async function board(env) {
    const raw = await env.STATS.get(k.board());
    const rows = raw ? JSON.parse(raw) : [];
    return json({ season: publicSeason(), players: rows.length, board: rows.slice(0, 50) });
}

const publicSeason = () => ({
    id: SEASON.id,
    name: SEASON.name,
    startsAt: SEASON.startsAt,
    endsAt: SEASON.endsAt,
    startingBalance: SEASON.startingBalance,
    maxLeverage: SEASON.maxLeverage,
    open: seasonOpen(),
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
