// Wires the practice engine to the screen. No framework: one file, one render function.
import { connectPrice } from './feed.js';
import { createPractice, RULES } from './practice.js';

const $ = (id) => document.getElementById(id);
const money = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signed = (n) => `${n >= 0 ? '+' : ''}${money(n)}`;

const practice = createPractice();
let side = 1;   // 1 long, -1 short

// --- the order form --------------------------------------------------------------------------

const collateralInput = $('collateral');
const leverageInput = $('leverage');

function formValues() {
    const collateral = Math.max(0, Number(collateralInput.value) || 0);
    const leverage = Math.min(Number(leverageInput.value) || 1, practice.maxLeverage());
    return { collateral, leverage };
}

function renderForm() {
    const { collateral, leverage } = formValues();
    const price = practice.price;
    const size = collateral * leverage;
    const band = practice.band();

    leverageInput.max = String(practice.maxLeverage());
    if (Number(leverageInput.value) > practice.maxLeverage()) leverageInput.value = String(practice.maxLeverage());
    $('lev-label').textContent = `${Number(leverageInput.value).toFixed(1)}×`;

    $('sum-size').textContent = price ? `${money(size)} USDT` : '—';
    $('sum-fee').textContent = `${money(size * RULES.feeRate)} USDT`;

    if (price && collateral > 0) {
        const qty = (collateral * (1 - RULES.feeRate * leverage) * leverage) / price;
        const fake = { side, collateral: collateral * (1 - RULES.feeRate * leverage), qty, entry: price };
        $('sum-liq').textContent = money(practice.liquidationPrice(fake));
        $('sum-worst').textContent = `${money(side === 1 ? price * (1 + band) : price * (1 - band))}  (${(band * 100).toFixed(1)}%)`;
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
    const result = practice.submit({ side, collateral, leverage });
    if (!result.ok) $('order-note').textContent = result.why;
};

$('close-btn').onclick = () => practice.close();
$('reset-btn').onclick = () => { if (confirm('Start again with 10,000 play USDT?')) practice.reset(); };
$('beginner-toggle').onchange = (e) => practice.setBeginner(e.target.checked);

// --- rendering -------------------------------------------------------------------------------

function renderPosition() {
    const { position, pending } = practice.state;
    const price = practice.price;

    $('no-position').hidden = !!(position || pending);
    $('position').hidden = !position;
    $('pending').hidden = !pending;

    if (pending) {
        const left = Math.max(0, Math.ceil((pending.fillsAt - Date.now()) / 1000));
        $('pend-left').textContent = `${left}s`;
        $('pend-price').textContent = money(pending.submittedPrice);
        $('pend-worst').textContent = money(pending.worst);
    }

    if (position && price) {
        const eq = practice.equity(position, price);
        const pnl = eq - position.collateral;
        $('pos-side').textContent = `${position.side === 1 ? 'Long' : 'Short'} ${position.leverage}×`;
        $('pos-size').textContent = `${money(position.qty * price)} USDT`;
        $('pos-entry').textContent = money(position.entry);
        $('pos-liq').textContent = money(practice.liquidationPrice(position));
        const el = $('pos-pnl');
        el.textContent = `${signed(pnl)} USDT  (${signed((pnl / position.collateral) * 100)}%)`;
        el.className = pnl >= 0 ? 'green' : 'red';
    }
}

function renderHistory() {
    const { history } = practice.state;
    const box = $('history');
    if (!history.length) { box.innerHTML = '<p class="muted" style="margin:0">Your trades will appear here.</p>'; return; }
    box.innerHTML = history.slice(0, 8).map((h) => {
        const when = new Date(h.at).toLocaleTimeString();
        if (h.kind === 'refused') {
            return `<div class="hist"><span class="amber">Order refused</span><span class="muted">price passed ${money(h.worst)} · ${when}</span></div>`;
        }
        if (h.kind === 'liquidated') {
            return `<div class="hist"><span class="red">Liquidated</span><span class="muted">lost ${money(h.collateral)} · ${when}</span></div>`;
        }
        const cls = h.pnl >= 0 ? 'green' : 'red';
        return `<div class="hist"><span class="${cls}">Closed ${h.side === 1 ? 'long' : 'short'} ${signed(h.pnl)}</span><span class="muted">${money(h.entry)} → ${money(h.exit)} · ${when}</span></div>`;
    }).join('');
}

function renderAll(_state, _price, event) {
    $('balance').textContent = money(practice.state.balance);
    $('price').textContent = practice.price ? money(practice.price) : '—';
    renderForm();
    renderPosition();
    renderHistory();

    if (event?.type === 'refused') {
        $('order-note').textContent = 'The price moved past your limit, so we did not open the position. Your play money is untouched.';
    } else if (event?.type === 'filled') {
        $('order-note').textContent = 'Filled. Watch the liquidation price as the market moves.';
    } else if (event?.type === 'liquidated') {
        $('order-note').textContent = 'Liquidated: the price reached the level where your collateral ran out. That is what liquidation feels like.';
    } else if (event?.type === 'submitted') {
        $('order-note').textContent = 'Submitted. It fills in about ten seconds, or not at all if the price moves too far.';
    }
}

practice.subscribe(renderAll);

// --- the live price --------------------------------------------------------------------------

connectPrice({
    onPrice: (p) => practice.onPrice(p),
    onStatus: ({ state, source, detail }) => {
        const dot = $('feed-dot');
        dot.className = state === 'live' ? 'dot' : 'dot warn';
        $('feed-status').textContent = state === 'live' ? `live · ${source}` : `${state}${detail ? ` · ${detail}` : ''}`;
        $('price-source').textContent = state === 'live' ? `${source}, streaming` : 'waiting for a price';
    },
});

setInterval(() => { practice.tick(); if (practice.state.pending) renderPosition(); }, 250);
renderAll();
