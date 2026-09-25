// Wires the practice engine, the price feed and the chart to the screen.
import { connectPrice } from './feed.js?v=5';
import { createPractice, RULES } from './practice.js?v=5';
import { createChart, loadCandles, loadStats, MARKERS } from './chart.js?v=5';
import { loadFunding, secondsToNextHour, clock } from './funding.js?v=5';

const $ = (id) => document.getElementById(id);
const money = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signed = (n) => `${n >= 0 ? '+' : ''}${money(n)}`;

const practice = createPractice();
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

    if (price && collateral > 0) {
        const lev = Number(leverageInput.value);
        const qty = (collateral * (1 - RULES.feeRate * lev) * lev) / price;
        $('sum-liq').textContent = money(practice.liquidationPrice({ side, collateral: collateral * (1 - RULES.feeRate * lev), qty, entry: price }));
        $('sum-worst').textContent = `${money(side === 1 ? price * (1 + band) : price * (1 - band))} (${(band * 100).toFixed(1)}%)`;
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

$('reset-btn').onclick = () => { if (confirm('Start again with 10,000 play USDT?')) practice.reset(); };
$('beginner-toggle').onchange = (e) => practice.setBeginner(e.target.checked);

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
        el.textContent = `${funding.perHourPct >= 0 ? '+' : ''}${funding.perHourPct.toFixed(4)}% / h`;
        el.className = funding.perHourPct >= 0 ? 'green' : 'red';
        el.title = `Live rate from ${funding.source}. Halyard's own rate will follow its own long and short balance.`;
    } catch {
        $('funding').textContent = 'unavailable';
    }
}
refreshFunding();
setInterval(refreshFunding, 180_000);
setInterval(() => { $('funding-clock').textContent = clock(secondsToNextHour()); }, 1000);

setInterval(() => { practice.tick(); if (practice.state.pending) renderPositions(); }, 250);
renderAll();
