// The slide runner: keyboard, dots, swipe, and a live price every slide is computed from.
//
// Slides live in deck.js as functions of the price, so the deck re-renders whenever a new tick
// arrives. Position is kept in localStorage so closing the tab does not lose your place.
import { SLIDES } from './deck.js?v=2';
import { connectPrice } from '../feed.js?v=6';

const $ = (id) => document.getElementById(id);
const KEY = 'halyard.slides.at';

let price = null;
let at = 0;
let furthest = 0;

try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (Number.isInteger(saved.at) && saved.at >= 0 && saved.at < SLIDES.length) at = saved.at;
    if (Number.isInteger(saved.furthest)) furthest = Math.min(saved.furthest, SLIDES.length - 1);
} catch { /* a fresh start is fine */ }

const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ at, furthest })); } catch { /* private mode */ }
};

// A slide is live-priced when its body takes the price as an argument.
const livePriced = (slide) => typeof slide.body === 'function' && slide.body.length > 0;

function render() {
    const slide = SLIDES[at];
    furthest = Math.max(furthest, at);

    // Dividers carry no body, and until the first tick arrives a slide that needs the price waits
    // rather than showing zeros.
    const body = !slide.body ? ''
        : livePriced(slide) && price === null ? '<p class="sub">Waiting for the live Bitcoin price…</p>'
        : slide.body(price);

    const heading = slide.kind === 'title' || slide.kind === 'divider' || slide.kind === 'end' ? 'h1' : 'h2';
    $('slide').innerHTML = `
      <${heading}>${slide.title}</${heading}>
      ${slide.sub ? `<p class="sub">${slide.sub}</p>` : ''}
      ${body}`;

    $('prev').disabled = at === 0;
    const next = $('next');
    next.textContent = at === SLIDES.length - 1 ? 'Finished' : 'Next';
    next.disabled = at === SLIDES.length - 1;
    $('count').textContent = `${at + 1} of ${SLIDES.length}`;

    for (const dot of $('dots').children) {
        const i = Number(dot.dataset.i);
        dot.className = `dot${i === at ? ' on' : i <= furthest ? ' seen' : ''}`;
    }
    save();
}

function go(to) {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, to));
    if (clamped === at) return;
    at = clamped;
    render();
    window.scrollTo({ top: 0 });
}

// --- the dots, one per slide -------------------------------------------------------------------

$('dots').innerHTML = SLIDES.map((s, i) => `<button class="dot" data-i="${i}" title="${s.title}" aria-label="Slide ${i + 1}: ${s.title}"></button>`).join('');
for (const dot of $('dots').children) dot.onclick = () => go(Number(dot.dataset.i));

$('prev').onclick = () => go(at - 1);
$('next').onclick = () => go(at + 1);

// --- keyboard and swipe -----------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(SLIDES.length - 1);
});

let touchX = null;
window.addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
window.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) go(at + (dx < 0 ? 1 : -1));
    touchX = null;
}, { passive: true });

// --- the live price ---------------------------------------------------------------------------

const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let lastRender = 0;

connectPrice({
    onPrice: (p) => {
        const first = price === null;
        price = p;
        $('live-price').textContent = fmt(p);
        // Re-render on the first tick, then at most every two seconds: the ticker moves several times
        // a second and redrawing the whole slide that often makes the text flicker while you read it.
        if (first || (livePriced(SLIDES[at]) && Date.now() - lastRender > 2000)) {
            lastRender = Date.now();
            render();
        }
    },
    onStatus: ({ state }) => {
        if (state !== 'live' && price === null) $('live-price').textContent = 'connecting…';
    },
});

render();
