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

// "Friday at 18:00" rather than an ISO timestamp, in the reader's own time zone.
function when(iso) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return 'soon';
    const day = at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${day} at ${time}`;
}

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
        $('arena-join').hidden = !!who || season?.open === false;
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

        // Between seasons the Arena is shut, and saying when it opens is more use than a dead clock.
        if (season.open === false) {
            $('arena-clock').textContent = season.opensAt ? `Opens ${when(season.opensAt)}` : 'Closed';
            $('arena-join').hidden = true;
            $('arena-shut').hidden = false;
            $('arena-shut').textContent = season.opensAt
                ? `The Arena is between seasons. ${season.name} opens ${when(season.opensAt)} — the table below is where the last one finished.`
                : 'The Arena is closed.';
            return;
        }
        $('arena-shut').hidden = true;
        $('arena-join').hidden = !!who;
        $('arena-clock').textContent = untilEnd(season.endsAt);
    }

    async function showBoard() {
        const data = await board().catch(() => null);
        if (!data?.board) return;
        season = data.season;
        showSeason();

        // Buying BTC at the open and doing nothing sits in the table at whatever rank it has earned.
        // It is the thing to beat, and on a quiet day it is the only other row.
        const rows = [...data.board.slice(0, 10), ...(data.benchmark ? [data.benchmark] : [])]
            .sort((a, b) => b.balance - a.balance);

        // The benchmark sits wherever its balance puts it but takes no rank, so the players are
        // still numbered 1, 2, 3 down the table.
        let rank = 0;
        $('arena-board').innerHTML = rows.map((row) => {
            if (!row.benchmark) rank += 1;
            const mine = who && !row.benchmark && row.name.toLowerCase() === who.name.toLowerCase();
            const classes = `lb${mine ? ' mine' : ''}${row.benchmark ? ' bench' : ''}${row.house ? ' bot' : ''}`;
            const clean = (s) => String(s ?? '').replace(/[<>&]/g, '');
            const label = row.benchmark
                ? `${row.name} <em>benchmark, not a player</em>`
                : row.house
                    ? `${clean(row.name)} <em>house bot · ${clean(row.blurb)}</em>`
                    : clean(row.name);
            return `<div class="${classes}">
                <span class="pos">${row.benchmark ? "·" : rank}</span>
                <span class="who">${label}</span>
                <span class="bal">${money(row.balance)}</span>
            </div>`;
        }).join('');

        $('arena-count').textContent = data.players === 1 ? '1 playing' : `${data.players} playing`;
        if (!data.board.length) {
            $('arena-empty').hidden = false;
            $('arena-empty').textContent = 'Nobody has finished a trade yet. Beat the benchmark and the table is yours.';
        } else {
            $('arena-empty').hidden = true;
        }
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
