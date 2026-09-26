// Counting how much the practice screen is used, without tracking anybody.
//
// One fire-and-forget request per event, carrying nothing but the event's name. No cookie, no
// identifier, no session, no payload. The counter on the other end (halyard-site/worker) adds one to
// an hourly total and forgets everything else, so these numbers can say "forty positions were opened
// today" and can never say who opened them.
//
// ENDPOINT is empty until the Worker is deployed, and while it is empty this file sends nothing at
// all — no requests leave the page. Switching it on means editing privacy.html in the same change.

const ENDPOINT = 'https://halyard-counter.r2rlabs.workers.dev';

const EVENTS = new Set(['visit', 'open', 'close', 'liquidated', 'expired']);

// `book` is optional: the long and short size of the simulated market in this browser, in BTC. Those
// two numbers are produced by our own code and describe nobody — they say how much practice trading
// is happening, never who is doing it.
export function count(event, book = null) {
    if (!ENDPOINT || !EVENTS.has(event)) return;
    const size = book && Number.isFinite(book.long) && Number.isFinite(book.short)
        ? `&l=${book.long.toFixed(3)}&s=${book.short.toFixed(3)}`
        : '';
    const url = `${ENDPOINT}/e?k=${event}${size}`;
    try {
        // sendBeacon survives the page being closed, which matters for the last event of a session.
        if (navigator.sendBeacon) navigator.sendBeacon(url);
        else fetch(url, { method: 'POST', keepalive: true, mode: 'cors' }).catch(() => {});
    } catch { /* a counter is never worth breaking the page for */ }
}
