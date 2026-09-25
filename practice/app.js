// Wires the practice engine, the price feed and the chart to the screen.
import { connectPrice } from './feed.js?v=13';
import { createPractice, RULES } from './practice.js?v=13';
import { createChart, loadCandles, loadStats, MARKERS } from './chart.js?v=13';
import { loadFunding, clock } from './funding.js?v=13';
import { createTour } from './tour.js?v=13';

const $ = (id) => document.getElementById(id);
const money = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signed = (n) => `${n >= 0 ? '+' : ''}${money(n)}`;

const practice = createPractice();
const tour = createTour(practice);
const chart = createChart($('chart'));
let side = 1;
let dayOpen = null;
let timeframe = 1;   // minutes per candle
let funding = null;

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

const LADDER_ROWS = 15;
const LADDER_STEP = 0.004;   // 0.4% a rung, so the ladder spans about 3% either way

function renderLadder() {
    const price = practice.price;
    if (!price) return;

    const position = practice.state.position;
    const { collateral } = formValues();
    const lev = Number(leverageInput.value);
    // An open position is shown as it really is; otherwise the order currently being set up.
    const qty = position ? position.qty : (collateral * lev) / price;
    const entry = position ? position.entry : price;

    const rows = [];
    const half = Math.floor(LADDER_ROWS / 2);
    for (let i = half; i >= -half; i--) {
        const at = price * (1 + i * LADDER_STEP);
        rows.push({ at, pnl: qty * (at - entry), here: i === 0 });
    }
    const biggest = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1e-9);
    const bar = (v) => `${Math.min(40, (Math.abs(v) / biggest) * 40)}%`;   // leave room for the number
    const tag = (v) => (Math.abs(v) < 0.005 ? '' : `${v > 0 ? '+' : '−'}${money(Math.abs(v))}`);

    $('ladder').innerHTML = rows.map((r) => `
      <div class="rung${r.here ? ' here' : ''}">
        <span class="side-cell l">${r.pnl > 0 ? `<b class="green">${tag(r.pnl)}</b><i style="width:${bar(r.pnl)}"></i>` : `<b class="red">${tag(r.pnl)}</b>`}</span>
        <span class="px">${money(r.at, 0)}</span>
        <span class="side-cell s">${r.pnl < 0 ? `<i style="width:${bar(r.pnl)}"></i><b class="green">${tag(-r.pnl)}</b>` : `<b class="red">${tag(-r.pnl)}</b>`}</span>
      </div>`).join('');

    $('ladder-foot').innerHTML = position
        ? `Your ${position.side === 1 ? 'long' : 'short'} against the trader on the other side. Liquidation at <span class="red">${money(practice.liquidationPrice(position), 0)}</span>.`
        : `Profit or loss on the ${money(collateral * lev, 0)} USDT order you are setting up. One side&rsquo;s gain is the other side&rsquo;s loss.`;
}

// --- positions and history -------------------------------------------------------------------

function renderPositions() {
    const { position, pending } = practice.state;
    const price = practice.price;
    const body = $('positions-body');

    $('pending-card').hidden = !pending;
    if (pending) {
        $('pend-left').textContent = `${Math.max(0, Math.ceil((pending.fillsAt - Date.now()) / 1000))}s`;
        $('pend-price').textContent = money(pending.submittedPrice);
        $('pend-worst').textContent = money(pending.worst);
    }

    if (!position) {
        body.innerHTML = `<tr><td colspan="8" class="empty">${pending ? 'Your order is filling…' : 'Nothing open. Place an order and it fills in about ten seconds.'}</td></tr>`;
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
    renderPositions();
    renderHistory();
    chart.setLines(markers());

    const notes = {
        refused: 'The price moved past your limit, so nothing opened. Your play money is untouched.',
        filled: 'Filled. Your entry and liquidation price are marked on the chart.',
        liquidated: 'Liquidated: the price reached the level where your collateral ran out. That is what it feels like.',
        submitted: 'Submitted. It fills in about ten seconds, or not at all if the price moves too far.',
        'stop-loss': 'Your stop-loss closed the position. That decision was made while you were calm, which is the point of it.',
        'take-profit': 'Your take-profit closed the position.',
    };
    if (event?.type && notes[event.type]) $('order-note').textContent = notes[event.type];
}

practice.subscribe(renderAll);

// --- live price ------------------------------------------------------------------------------

connectPrice({
    onPrice: (p) => { practice.onPrice(p); chart.tick(p, timeframe); },
    onStatus: ({ state, source, detail }) => {
        $('feed-dot').className = state === 'live' ? 'dot' : 'dot warn';
        $('feed-status').textContent = state === 'live' ? `live · ${source}` : `${state}${detail ? ` · ${detail}` : ''}`;
    },
});

// Funding: a real rate from an existing BTC perp, refreshed every few minutes, with the countdown to
// the hour when it would be charged.
async function refreshFunding() {
    try {
        funding = await loadFunding();
        const el = $('funding');
        el.textContent = `${funding.rate >= 0 ? '+' : ''}${funding.rate.toFixed(4)}%`;
        el.className = funding.rate >= 0 ? 'green' : 'red';
        el.title = `${funding.source} BTC perp, charged every ${funding.everyHours} hours. Halyard charges hourly from its own long and short balance.`;
    } catch {
        $('funding').textContent = 'unavailable';
    }
}
refreshFunding();
setInterval(refreshFunding, 180_000);
setInterval(() => { if (funding?.nextAt) $('funding-clock').textContent = clock(funding.nextAt - Date.now()); }, 1000);

setInterval(() => { practice.tick(); if (practice.state.pending) renderPositions(); }, 250);
renderAll();

// Someone arriving for the first time gets walked through it; everyone else asks for it.
tour.maybeStart();
