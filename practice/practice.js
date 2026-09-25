// The practice trading engine: live prices, play money, the same rules as the real thing.
//
// Deliberately mirrors production behaviour that people find surprising, because meeting it here for
// the first time is the entire point:
//   - orders take about ten seconds to fill, because that is what settling on Trac costs
//   - a fill outside your slippage band does not happen at all
//   - liquidation happens at 1% of position size, not at zero
// Funding is not modelled yet; it moves slowly and the lessons cover it separately.

export const RULES = {
    startingBalance: 10_000,
    feeRate: 0.0006,          // 0.06% to open and to close
    maintenanceMargin: 0.01,  // liquidated when equity falls to 1% of position size
    settleSeconds: 10,        // measured on Trac: 8-11s warm
    defaultBand: 0.005,       // 0.5%, the specced default
    beginnerBand: 0.003,      // beginners keep a tighter one
    maxLeverage: 5,
    beginnerLeverage: 2,
};

const STORE_KEY = 'halyard-practice-v1';

export function createPractice({ beginner = false } = {}) {
    const listeners = new Set();
    let price = null;

    const blank = () => ({
        balance: RULES.startingBalance,
        position: null,
        pending: null,
        history: [],
        beginner,
    });

    let state = load() ?? blank();

    function load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed.balance === 'number') ? parsed : null;
        } catch { return null; }   // private windows and cleared storage are fine: start fresh
    }

    function save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* not important */ }
    }

    const emit = (event) => { save(); for (const fn of listeners) fn(state, price, event); };

    const maxLeverage = () => (state.beginner ? RULES.beginnerLeverage : RULES.maxLeverage);
    const band = () => (state.beginner ? RULES.beginnerBand : RULES.defaultBand);

    const equity = (p, at) => p.collateral + p.side * p.qty * (at - p.entry);
    const liquidationPrice = (p) => {
        // equity = maintenanceMargin * size  =>  solve for price
        const m = RULES.maintenanceMargin;
        return p.side === 1
            ? (p.entry * p.qty - p.collateral) / (p.qty * (1 - m))
            : (p.entry * p.qty + p.collateral) / (p.qty * (1 + m));
    };

    function onPrice(next) {
        price = next;
        if (state.position) {
            const p = state.position;

            // Stop-loss and take-profit close before anything else, which is the point of them.
            const hitStop = p.stopLoss && (p.side === 1 ? price <= p.stopLoss : price >= p.stopLoss);
            const hitTarget = p.takeProfit && (p.side === 1 ? price >= p.takeProfit : price <= p.takeProfit);
            if (hitStop || hitTarget) {
                close(hitStop ? 'stop-loss' : 'take-profit');
                return;
            }

            if (equity(p, price) <= p.qty * price * RULES.maintenanceMargin) {
                // Liquidation: whatever is left goes, which is the lesson.
                state.history.unshift({
                    kind: 'liquidated', side: p.side, entry: p.entry, exit: price,
                    collateral: p.collateral, pnl: -p.collateral, at: Date.now(),
                });
                state.position = null;
                emit({ type: 'liquidated' });
                return;
            }
        }
        emit({ type: 'price' });
    }

    function submit({ side, collateral, leverage, stopLoss = null, takeProfit = null }) {
        if (state.pending) return { ok: false, why: 'An order is already filling.' };
        if (state.position) return { ok: false, why: 'Close your position first.' };
        if (!price) return { ok: false, why: 'Waiting for a price.' };
        const lev = Math.min(Math.max(1, leverage), maxLeverage());
        if (!(collateral > 0) || collateral > state.balance) return { ok: false, why: 'Not enough play USDT.' };

        const worst = side === 1 ? price * (1 + band()) : price * (1 - band());
        state.pending = {
            side, collateral, leverage: lev, stopLoss, takeProfit,
            submittedAt: Date.now(),
            submittedPrice: price,
            worst,
            fillsAt: Date.now() + RULES.settleSeconds * 1000,
        };
        emit({ type: 'submitted' });
        return { ok: true };
    }

    // Called on a timer by the UI: the wait is part of what practice teaches.
    function tick() {
        const pending = state.pending;
        if (!pending || !price) return;
        if (Date.now() < pending.fillsAt) { emit({ type: 'waiting' }); return; }

        const outside = pending.side === 1 ? price > pending.worst : price < pending.worst;
        if (outside) {
            state.pending = null;
            state.history.unshift({
                kind: 'refused', side: pending.side, submittedPrice: pending.submittedPrice,
                price, worst: pending.worst, at: Date.now(),
            });
            emit({ type: 'refused' });
            return;
        }

        const fee = pending.collateral * pending.leverage * RULES.feeRate;
        const collateral = pending.collateral - fee;
        state.balance -= pending.collateral;
        state.position = {
            side: pending.side,
            stopLoss: pending.stopLoss,
            takeProfit: pending.takeProfit,
            collateral,
            leverage: pending.leverage,
            entry: price,
            qty: (collateral * pending.leverage) / price,
            openedAt: Date.now(),
            fee,
        };
        state.pending = null;
        emit({ type: 'filled' });
    }

    function close(reason = 'closed') {
        const p = state.position;
        if (!p || !price) return { ok: false, why: 'Nothing to close.' };
        const eq = equity(p, price);
        const fee = Math.min(Math.max(eq, 0), p.qty * price * RULES.feeRate);
        const returned = Math.max(0, eq - fee);
        state.balance += returned;
        state.history.unshift({
            kind: 'closed', reason, side: p.side, entry: p.entry, exit: price,
            collateral: p.collateral, pnl: returned - p.collateral, at: Date.now(),
        });
        state.position = null;
        emit({ type: reason === 'closed' ? 'closed' : reason });
        return { ok: true };
    }

    function reset() {
        state = blank();
        emit({ type: 'reset' });
    }

    function setBeginner(on) {
        state.beginner = !!on;
        emit({ type: 'mode' });
    }

    return {
        RULES,
        onPrice, submit, tick, close, reset, setBeginner,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get state() { return state; },
        get price() { return price; },
        maxLeverage, band, equity, liquidationPrice,
    };
}
