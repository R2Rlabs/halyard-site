// A small matched-book market you can watch run.
//
// This is the browser cousin of halyard-sim: same rules, fewer of them. Traders arrive wanting to be
// long or short, orders are paired by quantity rather than price, the crowded side waits when nobody
// will take the other end, funding pays whoever does, and the insurance fund backs whatever gap is
// left. One step is one hour.
//
// It is a teaching toy, not a forecast. Nothing here predicts a price.

export const RULES = {
    leverage: 5,
    collateral: 500,          // every trader risks the same, to keep the picture readable
    feeRate: 0.0006,
    maintenance: 0.01,
    maxFundingPerHour: 0.0003, // 0.03%/hour at full imbalance, as specced
    fundCoverMove: 0.2,        // the fund backs an imbalance as if the price could move 20% against it
    queueHours: 24,
    openChance: 0.12,          // chance an idle trader opens in a given hour
    closeChance: 0.06,         // chance an open position is closed by its owner
    fundingPull: 2.5,          // how strongly funding tempts a trader to take the quiet side
};

export const MARKETS = {
    calm: { label: 'Calm', hourlyVol: 0.002, drift: 0 },
    normal: { label: 'Normal', hourlyVol: 0.005, drift: 0 },
    falling: { label: 'Falling hard', hourlyVol: 0.011, drift: -0.004 },
};

// Deterministic randomness, so the same settings tell the same story twice.
const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function createMarket({ price, traders = 60, bullish = 0.75, fund = 5000, market = 'normal', seed = 1 }) {
    const rnd = mulberry32(seed);
    const gauss = () => {
        const u = Math.max(1e-9, rnd());
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };

    const state = {
        hour: 0,
        price,
        startPrice: price,
        insurance: fund,
        startFund: fund,
        funding: 0,               // per hour, positive when longs pay shorts
        positions: [],            // {id, side, qty, entry, collateral, owner}
        queue: [],                // {id, side, qty, hour, owner}
        log: [],
        history: [],              // price per hour, for the chart
        stats: { filled: 0, waiting: 0, cancelled: 0, liquidated: 0, fees: 0, fundingPaid: 0, adl: 0 },
    };

    // Each trader has a private opinion. The crowd's average is the bullish slider.
    // Opinions run from barely-held to firm (0 to 1 either way). The weakly-held ones are the people
    // funding can buy: without them nobody ever changes their mind and the imbalance never clears.
    const people = Array.from({ length: traders }, (_, i) => ({
        id: i,
        view: rnd() < bullish ? rnd() : -rnd(),   // > 0 wants long, < 0 wants short
        // Not everyone trades at the maximum. Varied leverage is realistic, and it is what puts
        // liquidation levels at different prices instead of all at the same one.
        leverage: rnd() < 0.4 ? 2 : rnd() < 0.6 ? 3 : RULES.leverage,
        position: null,
    }));

    let nextId = 1;
    let lastFunding = 0;
    const say = (text, kind = 'plain') => {
        state.log.unshift({ hour: state.hour, text, kind });
        if (state.log.length > 40) state.log.pop();
    };

    const longQty = () => state.positions.reduce((n, p) => n + (p.side === 1 ? p.qty : 0), 0);
    const shortQty = () => state.positions.reduce((n, p) => n + (p.side === -1 ? p.qty : 0), 0);
    const imbalance = () => longQty() - shortQty();

    // How much one-sidedness the fund can stand behind, in BTC.
    const fundCapacity = () => Math.max(0, state.insurance / (state.price * RULES.fundCoverMove));

    const equity = (p) => p.collateral + p.side * p.qty * (state.price - p.entry);

    // The price at which a position runs out of margin. Longs die below it, shorts above.
    const liquidationPrice = (p) => (p.side === 1
        ? (p.entry * p.qty - p.collateral) / (p.qty * (1 - RULES.maintenance))
        : (p.entry * p.qty + p.collateral) / (p.qty * (1 + RULES.maintenance)));

    // A ladder of price levels with the positions that would be forced out at each one. This is the
    // honest version of a depth ladder: not resting orders, which do not exist here, but the levels
    // where the market is about to close people whether they like it or not.
    // The ladder spans whatever range the open positions actually occupy, rather than a fixed band:
    // a 2x position dies about 48% away and a 5x about 19%, so a fixed ladder either buries the
    // detail in its end rows or wastes half its height on empty prices.
    function ladder(rows = 13) {
        const liqs = state.positions.map(liquidationPrice);
        let lo = Math.min(state.price * 0.92, ...liqs);
        let hi = Math.max(state.price * 1.08, ...liqs);
        const pad = (hi - lo) * 0.04;
        lo -= pad; hi += pad;

        const step = (hi - lo) / rows;
        const out = [];
        for (let i = rows - 1; i >= 0; i--) {
            const low = lo + i * step;
            out.push({ mid: low + step / 2, lo: low, hi: low + step, longs: 0, shorts: 0, here: state.price >= low && state.price < low + step });
        }
        for (const p of state.positions) {
            const liq = liquidationPrice(p);
            const row = out.find((r) => liq >= r.lo && liq < r.hi) ?? (liq > hi ? out[0] : out[out.length - 1]);
            if (p.side === 1) row.longs++; else row.shorts++;
        }
        return out;
    }

    function closePosition(p, reason) {
        const person = people[p.owner];
        const pnl = equity(p) - p.collateral;
        state.positions.splice(state.positions.indexOf(p), 1);
        person.position = null;
        if (reason === 'liquidated') {
            // A close they had queued is moot now, and must not fill against an empty position.
            const queued = state.queue.find((o) => o.owner === p.owner && o.closing);
            if (queued) state.queue.splice(state.queue.indexOf(queued), 1);
            person.pending = false;
            state.stats.liquidated++;
            // Whatever the collateral could not cover falls to the fund.
            const shortfall = Math.min(0, equity(p));
            state.insurance += shortfall;
            say(`A ${p.side === 1 ? 'long' : 'short'} was liquidated${shortfall < 0 ? `, and the fund covered ${Math.abs(shortfall).toFixed(2)}` : ''}.`, 'bad');
        } else if (reason === 'adl') {
            state.stats.adl++;
        } else {
            state.stats.fees += p.qty * state.price * RULES.feeRate;
        }
        return pnl;
    }

    // Orders are paired by the direction they push the book, not by price: a trader opening a long and
    // a trader closing a long cancel out exactly as a long and a short would.
    function matchQueue() {
        let gaveUp = 0;
        for (const o of [...state.queue]) {
            if (state.hour - o.hour > RULES.queueHours) {
                state.queue.splice(state.queue.indexOf(o), 1);
                people[o.owner].pending = false;
                state.stats.cancelled++;
                gaveUp++;
            }
        }
        if (gaveUp) say(`${gaveUp} order${gaveUp === 1 ? '' : 's'} gave up after a day with no one on the other side.`, 'warn');

        const plus = state.queue.filter((o) => o.side === 1);
        const minus = state.queue.filter((o) => o.side === -1);

        // Pair them off one for one. Traders risk the same collateral but not the same leverage, so a
        // pair does not net to exactly zero; whatever is left over shows up in the imbalance below,
        // which is where it matters. The real contract splits orders to net exactly.
        const pairs = Math.min(plus.length, minus.length);
        for (let i = 0; i < pairs; i++) { fill(plus[i]); fill(minus[i]); }

        // Whatever is left is all on one side. It may fill only as far as the fund can back the gap.
        const leftovers = plus.length > minus.length ? plus.slice(pairs) : minus.slice(pairs);
        for (const o of leftovers) {
            const after = Math.abs(imbalance() + o.side * o.qty);
            const reduces = after < Math.abs(imbalance());
            if (reduces || after <= fundCapacity()) fill(o);
        }
        state.stats.waiting = state.queue.length;
    }

    function fill(order) {
        const i = state.queue.indexOf(order);
        if (i < 0) return;
        state.queue.splice(i, 1);
        const person = people[order.owner];
        person.pending = false;
        state.stats.filled++;

        // Closing is an order like any other: it pushes the book the opposite way to the position.
        if (order.closing) {
            if (person.position) closePosition(person.position, 'closed');
            return;
        }

        const lev = person.leverage;
        const collateral = RULES.collateral * (1 - RULES.feeRate * lev);
        const position = {
            id: nextId++, side: order.side, entry: state.price, owner: order.owner, leverage: lev,
            collateral, qty: (collateral * lev) / state.price,
        };
        state.positions.push(position);
        person.position = position;
        state.stats.fees += position.qty * state.price * RULES.feeRate;
    }

    function step() {
        state.hour++;

        // 1. The price moves.
        const m = MARKETS[market];
        state.price = Math.max(100, state.price * (1 + m.drift + m.hourlyVol * gauss()));
        state.history.push(state.price);
        if (state.history.length > 400) state.history.shift();

        // 2. Anyone out of margin is closed, whatever they wanted.
        for (const p of [...state.positions]) {
            if (equity(p) <= p.qty * state.price * RULES.maintenance) closePosition(p, 'liquidated');
        }

        // 3. Funding. The crowded side pays the quiet one, in proportion to how lopsided the book is.
        const total = longQty() + shortQty();
        state.funding = total > 0 ? (imbalance() / total) * RULES.maxFundingPerHour : 0;
        if (total > 0 && state.funding !== 0) {
            for (const p of state.positions) {
                const paid = p.side * state.funding * p.qty * state.price;
                p.collateral -= paid;
                state.stats.fundingPaid += Math.abs(paid) / 2;
            }
        }

        // 4. People act. Funding tempts some of them onto the side nobody wants.
        let switched = 0;
        for (const person of people) {
            if (person.pending) continue;            // they already have an order waiting
            if (person.position) {
                if (rnd() < RULES.closeChance) {
                    state.queue.push({ side: -person.position.side, qty: person.position.qty, hour: state.hour, owner: person.id, closing: true });
                    person.pending = true;
                }
                continue;
            }
            if (rnd() > RULES.openChance) continue;
            // A trader's view, nudged by what funding pays. Being paid 0.03%/hour to be short is
            // 0.72% a day, which changes minds.
            const nudge = -state.funding * RULES.fundingPull * 1000;
            const leaning = person.view + nudge;
            const side = leaning >= 0 ? 1 : -1;
            if (side !== (person.view >= 0 ? 1 : -1)) switched++;
            state.queue.push({ side, qty: (RULES.collateral * person.leverage) / state.price, hour: state.hour, owner: person.id });
            person.pending = true;
        }

        // 5. Match what can be matched, then say what changed — but only when it is worth saying.
        const before = state.stats.filled;
        const waitingBefore = state.queue.length;
        matchQueue();
        const filled = state.stats.filled - before;

        if (switched) {
            say(`${switched} trader${switched === 1 ? '' : 's'} took the unpopular side because funding pays them to.`, 'good');
        }
        if (filled >= 4) say(`${filled} orders filled against each other.`, 'plain');
        if (waitingBefore > 3 && state.queue.length === 0) {
            say('The book levelled out, and everything that was waiting filled at once.', 'good');
        }
        const reached = [0.0003, 0.0002, 0.0001].find((t) => Math.abs(state.funding) >= t && Math.abs(lastFunding) < t);
        if (reached) {
            const payer = state.funding > 0 ? 'longs' : 'shorts';
            const paid = state.funding > 0 ? 'shorts' : 'longs';
            say(`Funding reached ${(Math.abs(state.funding) * 100).toFixed(2)}% an hour — the ${payer} are paying the ${paid} to hold the other end.`, 'warn');
        }
        lastFunding = state.funding;

        return state;
    }

    return {
        RULES, MARKETS,
        step,
        get state() { return state; },
        longQty, shortQty, imbalance, fundCapacity, equity, ladder, liquidationPrice,
    };
}
