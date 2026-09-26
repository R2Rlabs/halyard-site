// Counting how much the practice screen is used, without tracking anybody.
//
// One fire-and-forget request per event, carrying nothing but the event's name. No cookie, no
// identifier, no session, no payload. The counter on the other end (halyard-site/worker) adds one to
// an hourly total and forgets everything else, so these numbers can say "forty positions were opened
// today" and can never say who opened them.
//
// ENDPOINT is empty until the Worker is deployed, and while it is empty this file sends nothing at
// all — no requests leave the page. Switching it on means editing privacy.html in the same change.

const ENDPOINT = '';

const EVENTS = new Set(['visit', 'open', 'close', 'liquidated', 'expired']);

export function count(event) {
    if (!ENDPOINT || !EVENTS.has(event)) return;
    const url = `${ENDPOINT}/e?k=${event}`;
    try {
        // sendBeacon survives the page being closed, which matters for the last event of a session.
        if (navigator.sendBeacon) navigator.sendBeacon(url);
        else fetch(url, { method: 'POST', keepalive: true, mode: 'cors' }).catch(() => {});
    } catch { /* a counter is never worth breaking the page for */ }
}
