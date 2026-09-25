// Renders the lessons and keeps track of which are finished.
import { connectPrice } from './feed.js?v=2';
import { LESSONS } from './lessons.js?v=2';

const STORE = 'halyard-learn-v1';
const $ = (id) => document.getElementById(id);
const money = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

let price = null;
let done = load();

function load() {
    try { return new Set(JSON.parse(localStorage.getItem(STORE) ?? '[]')); } catch { return new Set(); }
}
function save() {
    try { localStorage.setItem(STORE, JSON.stringify([...done])); } catch { /* fine */ }
}

// The helpers each lesson's body can use, so every figure follows the live price.
const helpers = () => {
    const p = price ?? 0;
    return [
        price ? money(price) : 'the current price',
        (collateral, lev) => money(collateral * lev),
        (lev) => {
            // liquidation for a long: equity falls to 1% of position size
            const m = 0.01;
            return price ? money(p * (1 - (1 - m * lev) / lev)) : '—';
        },
        (band) => (price ? money(p * (1 + band)) : '—'),
    ];
};

function renderProgress() {
    $('progress').innerHTML = LESSONS.map((l, i) => {
        const cls = done.has(l.id) ? 'done' : (i === LESSONS.findIndex((x) => !done.has(x.id)) ? 'current' : '');
        return `<div class="tick ${cls}" title="${l.title}"></div>`;
    }).join('');
    $('finish').hidden = done.size < LESSONS.length;
}

function renderLessons() {
    const [p, calc, liq, band] = helpers();
    $('lessons').innerHTML = LESSONS.map((l, i) => `
<div class="card" id="lesson-${l.id}">
  <h2>${i + 1}. ${l.title}</h2>
  <div class="meta">${l.minutes} min read${done.has(l.id) ? ' · finished' : ''}</div>
  ${l.body(p, calc, liq, band)}
  <div class="check" data-lesson="${l.id}">
    <div class="q">${l.check.question}</div>
    ${l.check.options.map((o, oi) => `<button class="opt" data-i="${oi}">${o}</button>`).join('')}
    <div class="why" hidden></div>
  </div>
</div>`).join('');

    for (const check of document.querySelectorAll('.check')) {
        const id = check.dataset.lesson;
        const lesson = LESSONS.find((l) => l.id === id);
        check.querySelectorAll('.opt').forEach((button) => {
            button.onclick = () => {
                const chosen = Number(button.dataset.i);
                const correct = chosen === lesson.check.answer;
                button.classList.add(correct ? 'right' : 'wrong');
                if (!correct) check.querySelectorAll('.opt')[lesson.check.answer].classList.add('right');
                check.querySelectorAll('.opt').forEach((b) => { b.disabled = true; });
                const why = check.querySelector('.why');
                why.textContent = lesson.check.why;
                why.hidden = false;
                done.add(id);
                save();
                renderProgress();
                const meta = document.querySelector(`#lesson-${id} .meta`);
                if (meta && !meta.textContent.includes('finished')) meta.textContent += ' · finished';
            };
        });
    }
}

renderProgress();
renderLessons();

connectPrice({
    onPrice: (next) => {
        const first = price === null;
        price = next;
        $('live-price').textContent = money(price);
        // Re-render once, when the first price lands, so the examples stop saying "the current price".
        if (first) { renderLessons(); renderProgress(); }
    },
    onStatus: ({ state }) => { if (state !== 'live') $('live-price').textContent = '—'; },
});
