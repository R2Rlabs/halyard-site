// Wires the practice engine, the price feed and the chart to the screen.
import { connectPrice } from './feed.js?v=28';
import { createPractice, RULES } from './practice.js?v=28';
import { createChart, loadCandles, loadStats, MARKERS } from './chart.js?v=28';
import { clock } from './funding.js?v=28';
import { createBook } from './book.js?v=28';
import { createTour } from './tour.js?v=28';
import { count } from './stats.js?v=28';

const $ = (id) => document.getElementById(id);
const money = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signed = (n) => `${n >= 0 ? '+' : ''}${money(n)}`;

const book = createBook();
const practice = createPractice({ book });
const tour = createTour(practice);
// Handy when working on the book locally; harmless in production.
if (location.hostname === 'localhost') window.__book = book;
const chart = createChart($('chart'));
let side = 1;
let dayOpen = null;
let timeframe = 1;   // minutes per candle

// --- chart -----------------------------------------------------------------------------------

(async () => {
    try {
        const candles = await loadCandles({ minutes: timeframe, limit: 180 });
        chart.setCandles(candles);
        chart.resize();
    } catch {
        $('chart-note').textContent = 'BTC/USD · chart history unavailable, the price above is still live';
    }
    try {
        const stats = await loadStats();
        if (stats) {
            dayOpen = stats.open;
            $('high').textContent = money(stats.high, 0);
            $('low').textContent = money(stats.low, 0);
        }
    } catch { /* the market bar simply stays quiet */ }
})();

function markers() {
    const p = practice.state.position;
    if (!p) return [];
    return [
        { price: p.entry, colour: MARKERS.entry, label: 'your entry' },
        { price: practice.liquidationPrice(p), colour: MARKERS.liquidation, label: 'liquidation', dash: [2, 3] },
        ...(p.stopLoss ? [{ price: p.stopLoss, colour: '#F2555A', label: 'stop-loss', dash: [1, 4] }] : []),
        ...(p.takeProfit ? [{ price: p.takeProfit, colour: '#34C77B', label: 'take-profit', dash: [1, 4] }] : []),
    ];
}

// --- order form ------------------------------------------------------------------------------

const collateralInput = $('collateral');
const leverageInput = $('leverage');

const formValues = () => ({
    collateral: Math.max(0, Number(collateralInput.value) || 0),
    leverage: Math.min(Number(leverageInput.value) || 1, practice.maxLeverage()),
});

function renderForm() {
    const { collateral, leverage } = formValues();
    const price = practice.price;
    const band = practice.band();

    leverageInput.max = String(practice.maxLeverage());
    if (Number(leverageInput.value) > practice.maxLeverage()) leverageInput.value = String(practice.maxLeverage());
    $('lev-label').textContent = `${Number(leverageInput.value).toFixed(1)}×`;

    const size = collateral * Number(leverageInput.value);
    $('sum-size').textContent = `${money(size)} USDT`;
    $('sum-fee').textContent = `${money(size * RULES.feeRate)} USDT`;

    // A trader may tighten the band but never widen it: loosening it is the direction that can hurt them.
    for (const b of document.querySelectorAll('#bands button')) {
        const value = Number(b.dataset.b);
        b.disabled = value > practice.maxBand();
        b.classList.toggle('on', !b.disabled && Math.abs(value - band) < 1e-9);
    }

    if (price && collateral > 0) {
        const lev = Number(leverageInput.value);
        const qty = (collateral * (1 - RULES.feeRate * lev) * lev) / price;
        $('sum-liq').textContent = money(practice.liquidationPrice({ side, collateral: collateral * (1 - RULES.feeRate * lev), qty, entry: price }));
        $('sum-worst').textContent = `${money(practice.worstPrice(side))} (${(band * 100).toFixed(2)}%)`;
    } else {
        $('sum-liq').textContent = '—';
        $('sum-worst').textContent = '—';
    }

    const button = $('submit-btn');
    button.textContent = `Open ${Number(leverageInput.value).toFixed(0)}× ${side === 1 ? 'long' : 'short'}`;
    button.classList.toggle('short', side === -1);
    button.disabled = !price || !!practice.state.position || !!practice.state.pending;
}

$('long-btn').onclick = () => { side = 1; $('long-btn').setAttribute('aria-pressed', 'true'); $('short-btn').setAttribute('aria-pressed', 'false'); renderForm(); };
$('short-btn').onclick = () => { side = -1; $('short-btn').setAttribute('aria-pressed', 'true'); $('long-btn').setAttribute('aria-pressed', 'false'); renderForm(); };
collateralInput.oninput = renderForm;
// Typing an exit puts it on the ladder straight away, before the order is placed.
$("stop-loss").oninput = renderLadder;
$("take-profit").oninput = renderLadder;
leverageInput.oninput = renderForm;
$('submit-btn').onclick = () => {
    const { collateral, leverage } = formValues();
    const stop = Number($('stop-loss').value) || null;
    const target = Number($('take-profit').value) || null;
    const result = practice.submit({ side, collateral, leverage, stopLoss: stop, takeProfit: target });
    if (!result.ok) $('order-note').textContent = result.why;
};
for (const b of document.querySelectorAll('#tfs button')) {
    b.onclick = async () => {
        timeframe = Number(b.dataset.m);
        for (const other of document.querySelectorAll('#tfs button')) other.classList.toggle('on', other === b);
        try { chart.setCandles(await loadCandles({ minutes: timeframe, limit: 180 })); } catch { /* keep what we have */ }
    };
}

for (const b of document.querySelectorAll('.pcts button')) {
    b.onclick = () => {
        collateralInput.value = Math.floor(practice.state.balance * Number(b.dataset.p));
        renderForm();
    };
}

for (const b of document.querySelectorAll('#bands button')) {
    b.onclick = () => {
        practice.setSlippage(Number(b.dataset.b));
        $('band-note').textContent = Number(b.dataset.b) <= 0.001
            ? 'Tight: you will rarely pay more than you expected, and more of your orders will be refused when the market is moving.'
            : 'The order fills at anything better than this, and does not fill at all past it.';
    };
}

$('reset-btn').onclick = () => { if (confirm('Start again with 10,000 play USDT?')) practice.reset(); };
$('tour-btn').onclick = () => tour.start();

// --- the ladder ---------------------------------------------------------------------------------
//
// Where another exchange shows resting buy and sell orders, we show the thing that actually exists
// here: what a long and a short of this size are worth at each price. They are mirror images,
// because in a matched book one side's gain is the other side's loss, to the cent.

const LADDER_ROWS = 19;
const LADDER_TICKS = [5, 10, 25, 50, 100, 250, 500, 1000];   // the rung sizes we are willing to use

// The rungs sit on fixed round prices and stay put, so the highlight travels up and down them as the
// market moves. Recomputing every rung from the live price instead would make all nineteen numbers
// churn on every tick, which is unreadable and tells you nothing about which way the price is going.
let ladderAnchor = null;

function renderLadder() {
    const price = practice.price;
    if (!price) return;

    const position = practice.state.position;
    const { collateral } = formValues();
    const lev = Number(leverageInput.value);
    // An open position is shown as it really is; otherwise the order currently being set up.
    const qty = position ? position.qty : (collateral * lev) / price;
    const entry = position ? position.entry : price;

    const half = Math.floor(LADDER_ROWS / 2);
    // About 0.35% a rung, rounded to a price people can hold in their head.
    const want = price * 0.0035;
    const tick = LADDER_TICKS.reduce((best, t) => (Math.abs(t - want) < Math.abs(best - want) ? t : best));
    // Re-centre only once the price is close to running off the end, so the ladder is mostly still.
    if (ladderAnchor === null || Math.abs(price - ladderAnchor) > tick * (half - 2)) {
        ladderAnchor = Math.round(price / tick) * tick;
    }

    const rows = [];
    for (let i = half; i >= -half; i--) {
        const at = ladderAnchor + i * tick;
        rows.push({ at, pnl: qty * (at - entry), here: price >= at - tick / 2 && price < at + tick / 2 });
    }

    const biggest = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1e-9);
    const bar = (v) => `${Math.min(40, (Math.abs(v) / biggest) * 40)}%`;   // leave room for the number
    const tag = (v) => (Math.abs(v) < 0.005 ? '' : `${v > 0 ? '+' : '−'}${money(Math.abs(v))}`);

    // Your own levels ride the ladder: the rung holding each one is named, so opening a position, or
    // typing a stop-loss, shows up here straight away.
    const marks = [];
    if (position) {
        marks.push({ price: position.entry, label: 'entry', cls: 'entry' });
        if (position.stopLoss) marks.push({ price: position.stopLoss, label: 'stop', cls: 'stop' });
        if (position.takeProfit) marks.push({ price: position.takeProfit, label: 'target', cls: 'target' });
    } else {
        const stop = Number($('stop-loss').value) || null;
        const target = Number($('take-profit').value) || null;
        if (stop) marks.push({ price: stop, label: 'stop', cls: 'stop' });
        if (target) marks.push({ price: target, label: 'target', cls: 'target' });
    }
    const markFor = (row) => marks.filter((m) => m.price >= row.at - tick / 2 && m.price < row.at + tick / 2);

    $('ladder').innerHTML = rows.map((r) => {
        const here = markFor(r);
        const flag = here.length ? `<u class="${here[0].cls}">${here.map((m) => m.label).join(' · ')}</u>` : '';
        return `
      <div class="rung${r.here ? ' here' : ''}${here.length ? ' marked' : ''}">
        <span class="side-cell l">${r.pnl > 0 ? `<b class="green">${tag(r.pnl)}</b><i style="width:${bar(r.pnl)}"></i>` : `<b class="red">${tag(r.pnl)}</b>`}</span>
        <span class="px">${money(r.at, 0)}${flag}</span>
        <span class="side-cell s">${r.pnl < 0 ? `<i style="width:${bar(r.pnl)}"></i><b class="green">${tag(-r.pnl)}</b>` : `<b class="red">${tag(-r.pnl)}</b>`}</span>
      </div>`;
    }).join('');

    $('ladder-foot').innerHTML = position
        ? `Your ${position.side === 1 ? 'long' : 'short'} against the trader on the other side. Liquidation at <span class="red">${money(practice.liquidationPrice(position), 0)}</span>.`
        : `Profit or loss on the ${money(collateral * lev, 0)} USDT order you are setting up. One side&rsquo;s gain is the other side&rsquo;s loss.`;
}

// --- positions and history -------------------------------------------------------------------

// The book: how much of each side is open, and how many orders are still looking for a counterparty.
function renderBook() {
    const long = book.longQty(), short = book.shortQty();
    const waitingOrders = book.waiting();
    const perOrder = practice.price ? (500 * 3) / practice.price : 0.02;
    const scale = Math.max(long, short, waitingOrders * perOrder, 0.001);
    const w = (v) => `${Math.min(100, (v / scale) * 100)}%`;

    $('bk-long').style.width = w(long);
    $('bk-short').style.width = w(short);
    $('bk-wait').style.width = w(waitingOrders * perOrder);
    $('bk-longv').textContent = long.toFixed(3);
    $('bk-shortv').textContent = short.toFixed(3);
    $('bk-waitv').textContent = String(waitingOrders);
}

function renderPositions() {
    const { position, pending } = practice.state;
    const price = practice.price;
    const body = $('positions-body');

    $('pending-card').hidden = !pending;
    if (pending) {
        const settling = Date.now() < pending.fillsAt;
        const secondsLeft = Math.max(0, Math.ceil((pending.fillsAt - Date.now()) / 1000));
        $('pend-title').textContent = settling ? 'Settling on Trac…' : 'Waiting for the other side';
        $('pend-left-k').textContent = settling ? 'Time left' : 'Waiting for';
        $('pend-left').textContent = settling
            ? `${secondsLeft}s`
            : `${Math.round((Date.now() - pending.fillsAt) / 1000)}s`;
        $('pend-price').textContent = money(pending.submittedPrice);
        $('pend-worst').textContent = money(pending.worst);
    }

    if (!position) {
        const note = pending
            ? (Date.now() < pending.fillsAt ? 'Your order is settling…' : 'Settled. Now it needs a trader taking the other side.')
            : 'Nothing open. Place an order and it fills once someone takes the other side.';
        body.innerHTML = `<tr><td colspan="8" class="empty">${note}</td></tr>`;
        return;
    }

    const eq = practice.equity(position, price);
    const pnl = eq - position.collateral;
    body.innerHTML = `<tr>
      <td class="name">BTC-PERP</td>
      <td><span class="badge ${position.side === 1 ? 'long' : 'short'}">${position.side === 1 ? 'Long' : 'Short'} ${position.leverage}×</span></td>
      <td>${money(position.qty * price)}</td>
      <td>${money(position.collateral)}</td>
      <td>${money(position.entry)}</td>
      <td class="red">${money(practice.liquidationPrice(position))}</td>
      <td class="${pnl >= 0 ? 'green' : 'red'}">${signed(pnl)} <span class="muted">(${signed((pnl / position.collateral) * 100)}%)</span></td>
      <td style="text-align:right"><button class="ghost" id="close-btn">Close</button></td>
    </tr>`;
    $('close-btn').onclick = () => practice.close();
}

function renderHistory() {
    const { history } = practice.state;
    const box = $('history');
    if (!history.length) { box.innerHTML = '<div class="empty">Your trades will appear here.</div>'; return; }
    box.innerHTML = history.slice(0, 8).map((h) => {
        const when = new Date(h.at).toLocaleTimeString();
        if (h.kind === 'funding') return `<div class="hist"><span class="${h.paid <= 0 ? 'green' : 'red'}">Funding ${h.paid <= 0 ? 'received' : 'paid'} ${money(Math.abs(h.paid))}</span><span class="muted">${(h.rate * 100).toFixed(4)}%/h · ${when}</span></div>`;
        if (h.kind === 'unmatched') return `<div class="hist"><span class="amber">Order expired · nobody took the other side</span><span class="muted">${money(h.submittedPrice)} · ${when}</span></div>`;
        if (h.kind === 'refused') return `<div class="hist"><span class="amber">Order refused · price passed your limit</span><span class="muted">${money(h.worst)} · ${when}</span></div>`;
        if (h.kind === 'liquidated') return `<div class="hist"><span class="red">Liquidated · lost ${money(h.collateral)}</span><span class="muted">${money(h.entry)} → ${money(h.exit)} · ${when}</span></div>`;
        return `<div class="hist"><span class="${h.pnl >= 0 ? 'green' : 'red'}">Closed ${h.side === 1 ? 'long' : 'short'} ${signed(h.pnl)}</span><span class="muted">${money(h.entry)} → ${money(h.exit)} · ${when}</span></div>`;
    }).join('');
}

function renderAll(_state, _price, event) {
    $('balance').textContent = money(practice.state.balance);
    if (practice.price) {
        $('price').textContent = money(practice.price);
        if (dayOpen) {
            const pct = (practice.price / dayOpen - 1) * 100;
            const el = $('change');
            el.textContent = `${signed(pct)}%`;
            el.className = `v ${pct >= 0 ? 'green' : 'red'}`;
        }
    }
    renderForm();
    renderLadder();
    renderBook();
    renderPositions();
    renderHistory();
    chart.setLines(markers());

    const notes = {
        refused: 'The price moved past your limit, so nothing opened. Your play money is untouched.',
        filled: 'Filled. Your entry and liquidation price are marked on the chart.',
        liquidated: 'Liquidated: the price reached the level where your collateral ran out. That is what it feels like.',
        submitted: 'Submitted. It settles in about ten seconds, then fills when a trader takes the other side.',
        queued: 'Settled. Now it needs traders on the other side, and the bigger the order the more of them it takes.',
        unmatched: 'Nobody took the other side before the order expired, so nothing opened. Your play money is untouched.',
        'stop-loss': 'Your stop-loss closed the position. That decision was made while you were calm, which is the point of it.',
        'take-profit': 'Your take-profit closed the position.',
    };
    if (event?.type && notes[event.type]) $('order-note').textContent = notes[event.type];

    // Totals only, so we can tell whether the thing is being used at all.
    const counted = {
        filled: 'open', closed: 'close', 'stop-loss': 'close', 'take-profit': 'close',
        liquidated: 'liquidated', unmatched: 'expired',
    };
    if (event?.type && counted[event.type]) count(counted[event.type]);
}

practice.subscribe(renderAll);

// --- live price ------------------------------------------------------------------------------

connectPrice({
    onPrice: (p) => { book.onPrice(p); practice.onPrice(p); chart.tick(p, timeframe); },
    onStatus: ({ state, source, detail }) => {
        $('feed-dot').className = state === 'live' ? 'dot' : 'dot warn';
        $('feed-status').textContent = state === 'live' ? `live · ${source}` : `${state}${detail ? ` · ${detail}` : ''}`;
    },
});

// Funding now comes from this screen's own book rather than from somebody else's exchange: the
// crowded side pays the quiet one, at up to 0.03% an hour, and the countdown is to the moment it is
// actually charged to your position.
function refreshFunding() {
    const rate = book.funding() * 100;
    const el = $('funding');
    el.textContent = `${rate >= 0 ? '+' : ''}${rate.toFixed(4)}%`;
    el.className = rate >= 0 ? 'green' : 'red';
    el.title = rate >= 0
        ? 'Longs are the crowded side here, so longs pay shorts. Charged to your position on the countdown.'
        : 'Shorts are the crowded side here, so shorts pay longs. Charged to your position on the countdown.';
    $('funding-clock').textContent = clock(book.nextFundingAt - Date.now());
}
setInterval(refreshFunding, 1000);
refreshFunding();

setInterval(() => { book.tick(); practice.tick(); if (practice.state.pending) renderPositions(); }, 250);
renderAll();

// Someone arriving for the first time gets walked through it; everyone else asks for it.
tour.maybeStart();
count('visit');
