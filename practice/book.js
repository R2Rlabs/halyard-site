// The other side of your trade, simulated locally.
//
// Practice used to fill every order after ten seconds against nobody, which taught the mechanics but
// hid the thing that actually bites in a matched book: an order only fills when someone pushes the
// book the other way. So this keeps a small population of simulated traders who arrive, take sides,
// and go home, and your order joins the same queue they do.
//
// Nothing here is a real person. It runs in your browser and nobody else can see it.

export const BOOK = {
    traders: 60,
    bullish: 0.58,          // the crowd leans long, the way crypto crowds usually do
    arrivalPerSecond: 0.8,  // how often somebody decides to trade
    closeChance: 0.02,      // per second, per open position
    orderLifeSeconds: 90,   // an unmatched order gives up after this
    collateral: 500,
    fundBacksBtc: 0.06,     // how much one-sidedness the insurance fund will stand behind
    maxFundingPerHour: 0.0003,
    fundingEverySeconds: 600, // practice charges every ten minutes so you can actually see it happen

    // A market nobody has traded in yet is an empty room, and an empty room makes a first-timer's
    // order sit there looking broken. So the book opens with positions already on both sides and
    // standing interest waiting, and tops that interest up as it gets taken.
    seedPositionsPerSide: 7,
    restingPerSide: 3,
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function createBook() {
    let price = null;
    let last = Date.now();
    let nextFundingAt = Date.now() + BOOK.fundingEverySeconds * 1000;

    const people = Array.from({ length: BOOK.traders }, (_, i) => ({
        id: i,
        view: Math.random() < BOOK.bullish ? Math.random() : -Math.random(),
        leverage: pick([2, 2, 3, 3, 5]),
        position: null,
        pending: false,
    }));

    const positions = [];   // simulated traders only; yours lives in practice.js
    const queue = [];       // {side, qty, at, owner, mine}

    const longQty = () => positions.reduce((n, p) => n + (p.side === 1 ? p.qty : 0), 0);
    const shortQty = () => positions.reduce((n, p) => n + (p.side === -1 ? p.qty : 0), 0);
    const imbalance = () => longQty() - shortQty();

    // Positive when longs are crowded, and so paying. Scaled by how lopsided the book is.
    const funding = () => {
        const total = longQty() + shortQty();
        return total > 0 ? (imbalance() / total) * BOOK.maxFundingPerHour : 0;
    };

    const waiting = () => queue.filter((o) => !o.mine).length;

    let seeded = false;

    function onPrice(next) {
        price = next;
        if (!seeded) { seed(); seeded = true; }
    }

    // Open the doors on a market that is already trading: positions on both sides, and standing
    // interest waiting on both sides so the first order anyone places has something to match against.
    function seed() {
        const idle = people.filter((p) => !p.position);
        let n = 0;
        for (const side of [1, -1]) {
            for (let i = 0; i < BOOK.seedPositionsPerSide; i++) {
                const person = idle[n++];
                if (person) openFor(person, side);
            }
        }
        topUpResting();
    }

    // Keep a little interest resting on each side. It is taken when someone matches against it, and
    // refilled here, which is what stops a quiet moment looking like a broken screen.
    function topUpResting() {
        if (!price) return;
        for (const side of [1, -1]) {
            let have = queue.filter((o) => !o.mine && o.side === side).length;
            while (have < BOOK.restingPerSide) {
                // Standing interest belongs to nobody in particular. Tying it to one of the named
                // traders meant it dried up the moment they were all in positions, which is exactly
                // when a newcomer needs something to trade against.
                queue.push({ side, qty: (BOOK.collateral * 3) / price, owner: -1, at: Date.now() });
                have++;
            }
        }
    }

    function openFor(person, side) {
        const collateral = BOOK.collateral;
        positions.push({ side, qty: (collateral * person.leverage) / price, entry: price, owner: person.id });
        person.position = positions[positions.length - 1];
    }

    function closeFor(person) {
        const i = positions.indexOf(person.position);
        if (i >= 0) positions.splice(i, 1);
        person.position = null;
    }

    // Your order joins the queue like anyone else's. It is not given priority, and it is not given
    // a counterparty that does not exist.
    function submit(order) {
        queue.push({ ...order, mine: true, at: Date.now() });
    }

    function withdraw() {
        const i = queue.findIndex((o) => o.mine);
        if (i >= 0) queue.splice(i, 1);
    }

    const queuedMine = () => queue.find((o) => o.mine) ?? null;

    // True once your order has actually been matched, at which point it leaves the queue.
    function matchedMine() {
        const mine = queuedMine();
        if (!mine) return false;

        // Matching is by quantity, not by order count: an ordinary order is covered by the interest
        // resting on the other side, while one far larger than the book waits, which is honest.
        const opposites = queue.filter((o) => !o.mine && o.side !== mine.side);
        const resting = opposites.reduce((n, o) => n + o.qty, 0);

        const after = imbalance() + mine.side * mine.qty;
        const fundCovers = Math.abs(after) < Math.abs(imbalance()) || Math.abs(after) <= BOOK.fundBacksBtc;
        if (resting < mine.qty && !fundCovers) return false;

        let taken = 0;
        for (const o of opposites) {
            if (taken >= mine.qty) break;
            queue.splice(queue.indexOf(o), 1);
            fillBot(o);
            taken += o.qty;
        }
        queue.splice(queue.indexOf(mine), 1);
        topUpResting();
        return true;
    }

    function fillBot(order) {
        if (order.owner === -1) {
            positions.push({ side: order.side, qty: order.qty, entry: price, owner: -1 });
            return;
        }
        const person = people[order.owner];
        if (!person) return;
        person.pending = false;
        if (order.closing) closeFor(person); else openFor(person, order.side);
    }

    function tick() {
        if (!price) return;
        const now = Date.now();
        const dt = Math.min(2, (now - last) / 1000);
        last = now;

        // Orders that waited too long give up, mine included — the app reports that as a refusal.
        for (const o of [...queue]) {
            if (now - o.at > BOOK.orderLifeSeconds * 1000) {
                queue.splice(queue.indexOf(o), 1);
                if (!o.mine && people[o.owner]) people[o.owner].pending = false;
            }
        }

        // Arrivals. Funding tempts the marginal ones onto the side nobody wants.
        const arrivals = BOOK.arrivalPerSecond * dt;
        for (let i = 0; i < people.length && Math.random() < arrivals; i++) {
            const person = pick(people);
            if (person.pending) continue;
            if (person.position) {
                if (Math.random() < 0.35) {
                    queue.push({ side: -person.position.side, qty: person.position.qty, owner: person.id, closing: true, at: now });
                    person.pending = true;
                }
                continue;
            }
            const nudge = -funding() * 2600;
            const side = person.view + nudge >= 0 ? 1 : -1;
            queue.push({ side, qty: (BOOK.collateral * person.leverage) / price, owner: person.id, at: now });
            person.pending = true;
        }

        // Standing interest that was taken up eventually goes home too.
        for (const p of positions.filter((x) => x.owner === -1)) {
            if (Math.random() < BOOK.closeChance * 2 * dt) positions.splice(positions.indexOf(p), 1);
        }

        // Somebody decides to go home.
        for (const person of people) {
            if (person.position && !person.pending && Math.random() < BOOK.closeChance * dt) {
                queue.push({ side: -person.position.side, qty: person.position.qty, owner: person.id, closing: true, at: now });
                person.pending = true;
            }
        }

        // Match the simulated traders against each other, oldest first.
        let guard = 60;
        while (guard-- > 0) {
            const longs = queue.filter((o) => !o.mine && o.side === 1);
            const shorts = queue.filter((o) => !o.mine && o.side === -1);
            if (!longs.length || !shorts.length) break;
            for (const o of [longs[0], shorts[0]]) {
                queue.splice(queue.indexOf(o), 1);
                fillBot(o);
            }
        }

        // Whatever is left over on one side fills only as far as the fund will back it. Resting
        // interest is exempt: it is there to be matched against, not to be swallowed by the fund.
        const resting = new Set();
        for (const side of [1, -1]) {
            queue.filter((o) => !o.mine && o.side === side).slice(0, BOOK.restingPerSide).forEach((o) => resting.add(o));
        }
        for (const o of queue.filter((x) => !x.mine && !resting.has(x))) {
            const after = imbalance() + o.side * o.qty;
            if (Math.abs(after) < Math.abs(imbalance()) || Math.abs(after) <= BOOK.fundBacksBtc) {
                queue.splice(queue.indexOf(o), 1);
                fillBot(o);
            }
        }

        topUpResting();
    }

    // Funding falls due on a timer. Practice uses ten minutes rather than an hour so a session can
    // actually see one; the rate itself is quoted per hour, as it will be for real.
    function fundingDue() {
        if (Date.now() < nextFundingAt) return null;
        nextFundingAt = Date.now() + BOOK.fundingEverySeconds * 1000;
        return funding() * (BOOK.fundingEverySeconds / 3600);
    }

    return {
        BOOK,
        onPrice, tick, submit, withdraw, matchedMine, queuedMine, fundingDue,
        longQty, shortQty, imbalance, waiting, funding,
        get nextFundingAt() { return nextFundingAt; },
        get positions() { return positions; },
    };
}
