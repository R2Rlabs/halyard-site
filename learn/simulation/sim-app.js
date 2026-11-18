// Drives the market simulation: controls, chart, and the running commentary that says in words what
// the numbers are doing.
import { createMarket, RULES } from './sim-engine.js?v=7';
import { connectPrice } from '../feed.js?v=2';

const $ = (id) => document.getElementById(id);
const m0 = (n) => Math.round(n).toLocaleString('en-US');
const pct = (n) => `${(n * 100).toFixed(4)}%`;

let market = null;
let timer = null;
let livePrice = null;
let settings = { bullish: 0.75, traders: 60, fund: 5000, market: 'normal' };

// --- the chart --------------------------------------------------------------------------------

const canvas = $('chart');
const ctx = canvas.getContext('2d');

function sizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawChart();
}
window.addEventListener('resize', sizeCanvas);

function drawChart() {
    const { width, height } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    const series = market?.state.history ?? [];
    if (series.length < 2) {
        ctx.fillStyle = '#98A2B0';
        ctx.font = '12px "IBM Plex Sans", sans-serif';
        ctx.fillText('The price appears once the market runs.', 12, height / 2);
        return;
    }

    const padRight = 58, padY = 10;
    const plotW = width - padRight, plotH = height - padY * 2;
    let lo = Math.min(...series), hi = Math.max(...series);
    const pad = (hi - lo) * 0.12 || 1;
    lo -= pad; hi += pad;
    const y = (v) => padY + plotH - ((v - lo) / (hi - lo)) * plotH;
    const x = (i) => (i / (series.length - 1)) * plotW;

    ctx.strokeStyle = '#1C222B';
    ctx.lineWidth = 1;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 3; i++) {
        const v = lo + ((hi - lo) * i) / 3;
        const py = Math.round(y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(plotW, py); ctx.stroke();
        ctx.fillStyle = '#98A2B0';
        ctx.fillText(m0(v), plotW + 8, py);
    }

    // The starting price, so a drop is obvious at a glance.
    const sy = Math.round(y(market.state.startPrice)) + 0.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#3A414C';
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(plotW, sy); ctx.stroke();
    ctx.setLineDash([]);

    const up = series[series.length - 1] >= market.state.startPrice;
    ctx.strokeStyle = up ? '#34C77B' : '#F2555A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();
}

// --- rendering --------------------------------------------------------------------------------

function render() {
    const s = market.state;
    const long = market.longQty(), short = market.shortQty();
    const waiting = s.queue.length;
    const capacity = market.fundCapacity();
    const scale = Math.max(long, short, capacity, waiting * (RULES.collateral * RULES.leverage) / s.price, 0.001);
    const width = (v) => `${Math.min(100, (v / scale) * 100)}%`;
    const perOrder = (RULES.collateral * RULES.leverage) / s.price;

    $('bar-long').style.width = width(long);
    $('bar-short').style.width = width(short);
    $('bar-wait').style.width = width(waiting * perOrder);
    $('bar-fund').style.width = width(capacity);
    $('v-long').textContent = `${long.toFixed(3)} BTC`;
    $('v-short').textContent = `${short.toFixed(3)} BTC`;
    $('v-wait').textContent = `${waiting} order${waiting === 1 ? '' : 's'}`;
    $('v-fund').textContent = `${capacity.toFixed(3)} BTC`;

    $('hours').textContent = s.hour;
    $('s-filled').textContent = s.stats.filled;
    $('s-waiting').textContent = waiting;
    $('s-cancelled').textContent = s.stats.cancelled;
    $('s-liq').textContent = s.stats.liquidated;
    $('s-funding').textContent = pct(s.funding);
    $('s-funding').className = `v ${s.funding > 0 ? 'green' : s.funding < 0 ? 'red' : ''}`;
    $('s-fund').textContent = m0(s.insurance);
    $('s-fund').className = `v ${s.insurance < s.startFund ? 'red' : ''}`;

    renderLadder();

    $('log').innerHTML = s.log.slice(0, 14).map((l) =>
        `<div><span class="h">h${l.hour}</span><span class="${l.kind}">${l.text}</span></div>`).join('');

    $('story').innerHTML = story(long, short, waiting);
    drawChart();
}

// The ladder: every price level with the positions that would be forced out there. Longs on the left,
// because they die as the price falls; shorts on the right, because they die as it rises.
function renderLadder() {
    const rows = market.ladder();
    const busiest = Math.max(1, ...rows.map((r) => Math.max(r.longs, r.shorts)));
    const bar = (n) => `${Math.max(n ? 8 : 0, (n / busiest) * 100)}%`;

    $('ladder').innerHTML = `<div class="ladder-head"><span>Longs forced out</span><span style="text-align:center">Price</span><span>Shorts forced out</span></div>`
        + rows.map((r) => `
      <div class="rung${r.here ? ' here' : ''}">
        <span class="lg">${r.longs ? `<b>${r.longs}</b><i style="width:${bar(r.longs)}"></i>` : ''}</span>
        <span class="px">${r.here ? m0(market.state.price) : m0(r.mid)}</span>
        <span class="sh">${r.shorts ? `<i style="width:${bar(r.shorts)}"></i><b>${r.shorts}</b>` : ''}</span>
      </div>`).join('');
}

// The commentary. It names the one thing that matters at this moment rather than listing everything.
function story(long, short, waiting) {
    const s = market.state;
    if (s.hour === 0) return 'Press <strong>Run</strong> and watch the book.';

    const total = long + short;
    const gap = Math.abs(long - short);
    const crowd = long > short ? 'long' : 'short';
    const quiet = long > short ? 'short' : 'long';
    const move = ((s.price / s.startPrice - 1) * 100).toFixed(1);
    const priceLine = `The price is <strong>${m0(s.price)}</strong>, ${Math.abs(move)}% ${s.price >= s.startPrice ? 'up' : 'down'}.`;

    if (waiting > total * 0.6 && waiting > 4) {
        return `${priceLine} <strong>${waiting} orders cannot fill.</strong> Almost everyone wants to be ${crowd}, and an order only fills when someone pushes the book the other way. They are waiting, not filling at a bad price — that is the whole trade-off of having no order book.`;
    }
    if (s.stats.liquidated > 0 && s.insurance < s.startFund) {
        return `${priceLine} ${s.stats.liquidated} position${s.stats.liquidated === 1 ? ' has' : 's have'} been liquidated, and the fund has paid <strong>${m0(s.startFund - s.insurance)}</strong> where collateral did not stretch. This is the only reason the insurance fund exists.`;
    }
    if (total > 0 && gap / total > 0.35) {
        return `${priceLine} The book is lopsided: <strong>${long.toFixed(2)} BTC long against ${short.toFixed(2)} short</strong>. So funding has moved to ${pct(Math.abs(s.funding))} an hour, paid by the ${crowd}s to the ${quiet}s. That payment is the only thing recruiting the side nobody wants.`;
    }
    if (total > 0) {
        return `${priceLine} The two sides are close to level — ${long.toFixed(2)} BTC long, ${short.toFixed(2)} short — so orders fill almost at once and funding is near zero. This is what a healthy matched book looks like.`;
    }
    return `${priceLine} Nobody is in the market yet.`;
}

// --- controls ---------------------------------------------------------------------------------

function reset() {
    stop();
    market = createMarket({
        price: livePrice ?? 84000,
        traders: settings.traders,
        bullish: settings.bullish,
        fund: settings.fund,
        market: settings.market,
        seed: Math.floor(Math.random() * 1e9),
    });
    render();
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    $('run').textContent = 'Run';
}

function run() {
    if (timer) { stop(); return; }
    $('run').textContent = 'Pause';
    timer = setInterval(() => { market.step(); render(); }, 380);
}

$('run').onclick = run;
$('step').onclick = () => { stop(); market.step(); render(); };
$('reset').onclick = reset;

$('bullish').oninput = (e) => {
    settings.bullish = Number(e.target.value) / 100;
    $('bullish-label').textContent = `${e.target.value}%`;
    reset();
};
$('traders').oninput = (e) => {
    settings.traders = Number(e.target.value);
    $('traders-label').textContent = e.target.value;
    reset();
};
$('fund').oninput = (e) => {
    settings.fund = Number(e.target.value);
    $('fund-label').textContent = m0(Number(e.target.value));
    reset();
};
for (const b of document.querySelectorAll('#market button')) {
    b.onclick = () => {
        settings.market = b.dataset.m;
        for (const other of document.querySelectorAll('#market button')) other.classList.toggle('on', other === b);
        reset();
    };
}

// --- start ------------------------------------------------------------------------------------

// The simulation starts from the real BTC price, so the numbers match the rest of the site.
connectPrice({
    onPrice: (p) => {
        const first = livePrice === null;
        livePrice = p;
        $('live-price').textContent = p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (first) reset();
    },
    onStatus: ({ state }) => { if (state !== 'live' && livePrice === null) $('live-price').textContent = 'connecting…'; },
});

sizeCanvas();
reset();
