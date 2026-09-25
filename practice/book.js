// The other side of your trade, simulated locally.
//
// Practice used to fill every order after ten seconds against nobody, which taught the mechanics but
// hid the thing that actually bites in a matched book: an order only fills when someone pushes the
// book the other way. So this keeps a small population of simulated traders who arrive, take sides,
// and go home, and your order joins the same queue they do.
//
// Nothing here is a real person. It runs in your browser and nobody else can see it.

export const BOOK = {
    traders: 44,
    bullish: 0.62,          // the crowd leans long, the way crypto crowds usually do
    arrivalPerSecond: 0.55, // how often somebody decides to trade
    closeChance: 0.012,     // per second, per open position
    orderLifeSeconds: 90,   // an unmatched order gives up after this
    collateral: 500,
    fundBacksBtc: 0.035,    // how much one-sidedness the insurance fund will stand behind
    maxFundingPerHour: 0.0003,
    fundingEverySeconds: 600, // practice charges every ten minutes so you can actually see it happen
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

    function onPrice(next) { price = next; }

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

        const opposite = queue.find((o) => !o.mine && o.side !== mine.side);
        if (opposite) {
            queue.splice(queue.indexOf(opposite), 1);
            queue.splice(queue.indexOf(mine), 1);
            fillBot(opposite);
            return true;
        }

        // Nobody is waiting on the other side. It can still fill if it makes the book less lopsided,
        // or if the insurance fund can stand behind the gap it would leave.
        const after = imbalance() + mine.side * mine.qty;
        if (Math.abs(after) < Math.abs(imbalance()) || Math.abs(after) <= BOOK.fundBacksBtc) {
            queue.splice(queue.indexOf(mine), 1);
            return true;
        }
        return false;
    }

    function fillBot(order) {
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

        // Whatever is left over on one side fills only as far as the fund will back it.
        for (const o of queue.filter((x) => !x.mine)) {
            const after = imbalance() + o.side * o.qty;
            if (Math.abs(after) < Math.abs(imbalance()) || Math.abs(after) <= BOOK.fundBacksBtc) {
                queue.splice(queue.indexOf(o), 1);
                fillBot(o);
            }
        }
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
