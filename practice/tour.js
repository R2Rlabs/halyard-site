// A guided walkthrough of the trading screen.
//
// It does not play a video at you: it points at the real control, waits until you actually use it,
// and only then moves on. The steps that teach something rather than ask for something advance on a
// button instead, so nobody gets stuck.
//
// The spotlight is one trick: a 9999px box-shadow on the target dims everything else without
// covering it, so every control stays clickable while it is highlighted.

const KEY = 'halyard.tour.done';
const $ = (s) => document.querySelector(s);
const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

// Each step points at one element. `waitFor` advances on a real action; without it, Next does.
const STEPS = [
    {
        at: '.market',
        title: 'This price is real',
        text: () => 'Bitcoin, live from a public exchange feed, moving as you read this. The money is play money — the market is not.',
    },
    {
        at: '.side',
        title: 'Pick a direction',
        text: () => 'Long if you think it goes up, short if you think it goes down. Press one of them now.',
        waitFor: { click: '#long-btn, #short-btn' },
        hint: 'Press Long or Short to carry on',
    },
    {
        at: '#collateral',
        title: 'Decide how much to risk',
        text: () => 'This is what you put in, and the most you can lose. The slider underneath multiplies it: 500 at 5× controls 2,500, so every 1% move is 5% of your money.',
    },
    {
        at: '#sum-rows',
        title: 'Read these two before you press',
        text: (p) => {
            const liq = $('#sum-liq')?.textContent ?? '—';
            const worst = $('#sum-worst')?.textContent ?? '—';
            return `<strong>Liquidation price ${liq}</strong> is where the trade closes itself and your collateral is gone. <strong>Worst price ${worst}</strong> is the limit: if the market passes it while your order settles, nothing opens at all.`;
        },
    },
    {
        at: '#submit-btn',
        title: 'Open it',
        text: () => 'Press the button. Nothing is deposited and nothing can be lost.',
        waitFor: { state: (p) => !!p.state.pending || !!p.state.position },
        hint: 'Press the orange button to carry on',
    },
    {
        at: '#pending-card',
        title: 'These ten seconds are the point',
        text: () => 'Other exchanges fill instantly because they hold your money and settle later. Halyard settles on Trac, and the wait is real. Watch it count down.',
        waitFor: { state: (p) => !p.state.pending },
    },
    {
        at: '#positions-body',
        title: (p) => (p.state.position ? 'You are in the trade' : 'Your order was refused'),
        text: (p) => {
            if (!p.state.position) {
                return 'The price moved past the limit you accepted while the order settled, so nothing opened and your money is untouched. That is the protection working, not a failure. Try again.';
            }
            const pos = p.state.position;
            return `Profit and loss moves with every tick. Your entry and your liquidation at <strong>${money(p.liquidationPrice(pos))}</strong> are drawn on the chart, so you can see how far the price has to go before this ends badly.`;
        },
    },
    {
        at: '#positions-body',
        title: 'Closing is yours to choose',
        text: (p) => (p.state.position
            ? 'Close whenever you like and the profit or loss is settled. Or leave it and watch: the whole point of practice is finding out what you actually do when it moves against you.'
            : 'When a position is open, you close it here whenever you like.'),
    },
    {
        at: '#history',
        title: 'That is the whole thing',
        text: () => 'Every trade lands here. Now do the three that teach you the most: a short, a stop-loss that fires, and a 5× position you let get liquidated on purpose — while it costs nothing.',
        last: true,
    },
];

export function createTour(practice) {
    let i = 0;
    let running = false;
    let target = null;
    let poll = null;
    let clickHandler = null;

    const bubble = document.createElement('div');
    bubble.className = 'tour-bubble';
    bubble.hidden = true;
    document.body.appendChild(bubble);

    const clear = () => {
        if (target) target.classList.remove('tour-on');
        target = null;
        if (poll) { clearInterval(poll); poll = null; }
        if (clickHandler) { document.removeEventListener('click', clickHandler, true); clickHandler = null; }
    };

    function place() {
        if (!target) return;
        const r = target.getBoundingClientRect();
        const narrow = window.innerWidth < 760;
        if (narrow) {
            bubble.style.left = '12px';
            bubble.style.right = '12px';
            bubble.style.width = 'auto';
            // Below the target when it sits in the top half, above it otherwise, so it never covers it.
            const below = r.bottom < window.innerHeight / 2;
            bubble.style.top = below ? `${r.bottom + 12}px` : `${Math.max(12, r.top - bubble.offsetHeight - 12)}px`;
            return;
        }
        bubble.style.right = 'auto';
        bubble.style.width = '340px';
        const left = Math.min(Math.max(12, r.left), window.innerWidth - 352);
        bubble.style.left = `${left}px`;
        const room = window.innerHeight - r.bottom;
        bubble.style.top = room > bubble.offsetHeight + 24
            ? `${r.bottom + 12}px`
            : `${Math.max(12, r.top - bubble.offsetHeight - 12)}px`;
    }

    function show() {
        const step = STEPS[i];
        clear();

        target = $(step.at);
        // A hidden card (the pending one before an order exists) has nothing to point at: skip past it.
        if (!target || target.hidden || target.offsetParent === null) {
            if (step.waitFor?.state && step.waitFor.state(practice)) { next(); return; }
            if (!target) { next(); return; }
        }

        const title = typeof step.title === 'function' ? step.title(practice) : step.title;
        const waiting = !!step.waitFor;
        bubble.innerHTML = `
          <div class="tour-step">Step ${i + 1} of ${STEPS.length}</div>
          <h3>${title}</h3>
          <p>${step.text(practice)}</p>
          <div class="tour-nav">
            ${waiting
                ? `<span class="tour-hint">${step.hint ?? 'Carry on when you are ready'}</span>`
                : `<button class="tour-next">${step.last ? 'Done' : 'Next'}</button>`}
            <button class="tour-skip">${step.last ? '' : 'Skip the tour'}</button>
          </div>`;
        bubble.hidden = false;

        if (target) {
            target.classList.add('tour-on');
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        requestAnimationFrame(place);

        bubble.querySelector('.tour-next')?.addEventListener('click', next);
        bubble.querySelector('.tour-skip')?.addEventListener('click', stop);

        if (step.waitFor?.click) {
            clickHandler = (e) => { if (e.target.closest(step.waitFor.click)) setTimeout(next, 420); };
            document.addEventListener('click', clickHandler, true);
        }
        if (step.waitFor?.state) {
            poll = setInterval(() => { if (step.waitFor.state(practice)) next(); }, 250);
        }
    }

    function next() {
        if (!running) return;
        if (i >= STEPS.length - 1) { stop(); return; }
        i += 1;
        show();
    }

    function stop() {
        running = false;
        clear();
        bubble.hidden = true;
        try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    }

    function start() {
        i = 0;
        running = true;
        show();
    }

    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('keydown', (e) => { if (running && e.key === 'Escape') stop(); });

    return {
        start,
        stop,
        // First-timers are walked through it; everyone else has to ask.
        maybeStart() {
            let seen = false;
            try { seen = !!localStorage.getItem(KEY); } catch { /* treat as unseen */ }
            if (seen || practice.state.history.length || practice.state.position) return;
            setTimeout(start, 900);
        },
    };
}
