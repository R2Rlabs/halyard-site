// Live BTC price for practice mode.
//
// Practice runs entirely in the browser, so it needs a price source with no API key. Coinbase and
// Kraken both stream publicly and both work from the United States, which matters because lessons and
// practice are open everywhere even though real trading is not.
//
// This is NOT the oracle. Real trading uses Pyth prices with signatures verified on-chain by every
// node. Practice only needs a believable price, and saying so plainly is part of the teaching.

const SOURCES = [
    {
        name: 'Coinbase',
        url: 'wss://ws-feed.exchange.coinbase.com',
        subscribe: { type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker'] },
        read: (m) => (m.type === 'ticker' && m.price ? Number(m.price) : null),
    },
    {
        name: 'Kraken',
        url: 'wss://ws.kraken.com/v2',
        subscribe: { method: 'subscribe', params: { channel: 'ticker', symbol: ['BTC/USD'] } },
        read: (m) => (m.channel === 'ticker' && m.data?.[0]?.last ? Number(m.data[0].last) : null),
    },
];

export function connectPrice({ onPrice, onStatus }) {
    let index = 0;
    let socket = null;
    let closed = false;
    let idleTimer = null;

    const status = (state, detail) => onStatus?.({ state, source: SOURCES[index]?.name, detail });

    const nextSource = (why) => {
        if (closed) return;
        status('reconnecting', why);
        index = (index + 1) % SOURCES.length;
        setTimeout(open, 1500);
    };

    // A socket that stays open but stops sending is worse than one that drops: the price silently
    // goes stale. If nothing arrives for 30 seconds, move on.
    const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { try { socket?.close(); } catch {} nextSource('no prices for 30s'); }, 30_000);
    };

    const open = () => {
        if (closed) return;
        const source = SOURCES[index];
        status('connecting');
        try {
            socket = new WebSocket(source.url);
        } catch {
            return nextSource('could not open');
        }
        socket.onopen = () => { socket.send(JSON.stringify(source.subscribe)); resetIdle(); };
        socket.onmessage = (event) => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            const price = source.read(message);
            if (price && Number.isFinite(price)) {
                resetIdle();
                status('live');
                onPrice(price);
            }
        };
        socket.onerror = () => { try { socket.close(); } catch {} };
        socket.onclose = () => { clearTimeout(idleTimer); if (!closed) nextSource('connection closed'); };
    };

    open();
    return { close() { closed = true; clearTimeout(idleTimer); try { socket?.close(); } catch {} } };
}
