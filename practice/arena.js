// The Arena, on the trading screen.
//
// Everything that decides a rank happens on the server: you send a finished trade — side, size, both
// prices, both times — and it checks those prices against what BTC really did, prices the trade
// itself, and keeps the balance. Nothing this file says about your money is believed.
//
// It mounts only if the page has an Arena panel, so the ordinary practice screen is untouched.

const ENDPOINT = 'https://halyard-counter.r2rlabs.workers.dev';
const STORE = 'halyard.arena.v1';

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const load = () => {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
};
const save = (who) => {
    try { localStorage.setItem(STORE, JSON.stringify(who)); } catch { /* private mode */ }
};

async function call(path, options = {}) {
    const res = await fetch(`${ENDPOINT}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
    let body = {};
    try { body = await res.json(); } catch { /* an empty body is still an answer */ }
    return { ok: res.ok, status: res.status, ...body };
}

const claim = (name) => call('/arena/claim', { method: 'POST', body: JSON.stringify({ name }) });
const board = () => call('/arena/board');
const me = (name) => call(`/arena/me?name=${encodeURIComponent(name)}`);
const sendTrade = (trade) => call('/arena/trade', { method: 'POST', body: JSON.stringify(trade) });

// Counts down to the end of the season, or says it has finished.
function untilEnd(endsAt) {
    const left = Date.parse(endsAt) - Date.now();
    if (!Number.isFinite(left) || left <= 0) return 'Season over';
    const days = Math.floor(left / 86400000);
    const hours = Math.floor((left % 86400000) / 3600000);
    const mins = Math.floor((left % 3600000) / 60000);
    return days > 0 ? `${days}d ${hours}h left` : `${hours}h ${mins}m left`;
}

export function mountArena(practice) {
    if (!$('arena-panel')) return;

    let who = load();
    let season = null;

    // --- painting ---------------------------------------------------------------------------

    function showWho() {
        $('arena-join').hidden = !!who;
        $('arena-you').hidden = !who;
        if (who) {
            $('arena-name').textContent = who.name;
            $('arena-balance').textContent = money(who.balance ?? 0);
            const change = (who.balance ?? 0) - (season?.startingBalance ?? 10000);
            const el = $('arena-change');
            el.textContent = `${change >= 0 ? '+' : '−'}${money(Math.abs(change))}`;
            el.className = change >= 0 ? 'green' : 'red';
            $('arena-trades').textContent = String(who.trades ?? 0);
        }
    }

    function showSeason() {
        if (!season) return;
        $('arena-season').textContent = season.name;
        $('arena-clock').textContent = untilEnd(season.endsAt);
    }

    async function showBoard() {
        const data = await board().catch(() => null);
        if (!data?.board) return;
        season = data.season;
        showSeason();

        const rows = data.board.slice(0, 10);
        $('arena-board').innerHTML = rows.length
            ? rows.map((row, i) => {
                const mine = who && row.name.toLowerCase() === who.name.toLowerCase();
                return `<div class="lb${mine ? ' mine' : ''}">
                    <span class="pos">${i + 1}</span>
                    <span class="who">${row.name.replace(/[<>&]/g, '')}</span>
                    <span class="bal">${money(row.balance)}</span>
                </div>`;
            }).join('')
            : '<div class="empty">Nobody has finished a trade yet. The first person to close one is top of the table.</div>';

        if (rows.length) $('arena-count').textContent = `${data.players} playing`;
    }

    const say = (text, kind = '') => { const el = $('arena-note'); el.textContent = text; el.className = `arena-note ${kind}`; };

    // --- joining ----------------------------------------------------------------------------

    $('arena-claim').onclick = async () => {
        const name = $('arena-input').value.trim();
        if (!name) return;
        $('arena-claim').disabled = true;
        say('Claiming…');
        const result = await claim(name).catch(() => ({ error: 'Could not reach the Arena.' }));
        $('arena-claim').disabled = false;
        if (!result.ok) { say(result.error ?? 'That did not work.', 'bad'); return; }
        who = { name: result.name, secret: result.secret, balance: result.balance, trades: 0 };
        season = result.season;
        save(who);
        say('You are in. Every trade you close from now on is verified and counted.', 'good');
        showWho(); showSeason(); showBoard();
    };

    $('arena-input').onkeydown = (e) => { if (e.key === 'Enter') $('arena-claim').click(); };

    // --- submitting -------------------------------------------------------------------------

    // Every finished trade goes up. A refusal is reported as plainly as an acceptance: being told why
    // the Arena would not count something is more useful than a silent failure.
    async function submit(trade, attempt = 1) {
        if (!who) return;
        const body = {
            name: who.name,
            secret: who.secret,
            side: trade.side,
            qty: trade.qty,
            entry: trade.entry,
            exit: trade.exit,
            collateral: trade.collateral,
            openedAt: trade.openedAt,
            closedAt: trade.at,
        };
        say('Verifying that trade against the real price history…');
        const result = await sendTrade(body).catch(() => ({ error: 'Could not reach the Arena.' }));

        if (result.ok) {
            who.balance = result.balance;
            who.trades = (who.trades ?? 0) + 1;
            save(who);
            const sign = result.pnl >= 0 ? '+' : '−';
            say(`Counted: ${sign}${money(Math.abs(result.pnl))}. Arena balance ${money(result.balance)}.`,
                result.pnl >= 0 ? 'good' : 'bad');
            showWho(); showBoard();
            return;
        }
        // A trade closed seconds ago sits in a minute the exchanges have not published yet, so the
        // price history genuinely is not there to check against. That is worth waiting for rather
        // than throwing the trade away, so it goes again in a minute, twice.
        if (result.status === 503 && attempt <= 2) {
            say('The price history for that minute is not published yet. Checking again in a minute — leave this open.');
            setTimeout(() => submit(trade, attempt + 1), 62_000);
            return;
        }
        say(result.error ?? 'The Arena would not count that trade.', 'bad');
    }

    practice.subscribe((_state, _price, event) => {
        if (!event?.type || !who) return;
        if (!['closed', 'stop-loss', 'take-profit', 'liquidated'].includes(event.type)) return;
        const last = practice.state.history[0];
        if (!last || !Number.isFinite(last.qty) || !Number.isFinite(last.openedAt)) return;
        submit(last);
    });

    // --- go ---------------------------------------------------------------------------------

    showWho();
    showBoard();
    setInterval(showBoard, 45_000);
    setInterval(showSeason, 30_000);

    // If this browser already has a name, trust the server's balance over whatever is stored here.
    if (who) {
        me(who.name).then((data) => {
            if (!data.ok) return;
            who.balance = data.balance;
            who.trades = data.trades;
            season = data.season;
            save(who);
            showWho(); showSeason();
        }).catch(() => {});
    }
}
