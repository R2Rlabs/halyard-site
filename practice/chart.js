// A candlestick chart drawn on a canvas. No library: the whole thing is a few hundred lines and a
// dependency would be larger than the page.
//
// Candles come from Coinbase's public REST endpoint on load, then the live price extends the newest
// candle as it ticks, so the chart moves while you watch it.

const UP = '#34C77B', DOWN = '#F2555A', GRID = '#1C222B', TEXT = '#98A2B0', AMBER = '#F0A63A';

export async function loadCandles({ minutes = 1, limit = 180 } = {}) {
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${minutes * 60}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`candles HTTP ${res.status}`);
    // [ time, low, high, open, close, volume ], newest first
    const rows = await res.json();
    return rows
        .map((r) => ({ t: r[0] * 1000, l: r[1], h: r[2], o: r[3], c: r[4], v: r[5] }))
        .sort((a, b) => a.t - b.t)
        .slice(-limit);
}

export async function loadStats() {
    const res = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/stats');
    if (!res.ok) return null;
    const s = await res.json();
    return { open: Number(s.open), high: Number(s.high), low: Number(s.low), last: Number(s.last) };
}

export function createChart(canvas) {
    let candles = [];
    let lines = [];        // horizontal markers: entry, liquidation
    const ctx = canvas.getContext('2d');

    const resize = () => {
        const ratio = window.devicePixelRatio || 1;
        const { width, height } = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(width * ratio));
        canvas.height = Math.max(1, Math.floor(height * ratio));
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        draw();
    };
    window.addEventListener('resize', resize);

    function draw() {
        const { width, height } = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, width, height);
        if (!candles.length) return;

        const padRight = 62, padBottom = 20, padTop = 8;
        const plotW = width - padRight, plotH = height - padBottom - padTop;

        let lo = Infinity, hi = -Infinity;
        for (const c of candles) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
        for (const line of lines) { if (line.price > 0 && line.price < hi * 3) { lo = Math.min(lo, line.price); hi = Math.max(hi, line.price); } }
        const pad = (hi - lo) * 0.08 || 1;
        lo -= pad; hi += pad;

        const y = (price) => padTop + plotH - ((price - lo) / (hi - lo)) * plotH;
        const slot = plotW / candles.length;
        const bodyW = Math.max(1, Math.min(9, slot * 0.62));

        // price grid
        ctx.font = '11px "IBM Plex Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = GRID;
        ctx.fillStyle = TEXT;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const price = lo + ((hi - lo) * i) / 4;
            const py = Math.round(y(price)) + 0.5;
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(plotW, py); ctx.stroke();
            ctx.fillText(price.toLocaleString('en-US', { maximumFractionDigits: 0 }), plotW + 8, py);
        }

        // candles
        candles.forEach((c, i) => {
            const cx = i * slot + slot / 2;
            const up = c.c >= c.o;
            ctx.strokeStyle = up ? UP : DOWN;
            ctx.fillStyle = up ? UP : DOWN;
            ctx.beginPath();
            ctx.moveTo(Math.round(cx) + 0.5, y(c.h));
            ctx.lineTo(Math.round(cx) + 0.5, y(c.l));
            ctx.stroke();
            const top = y(Math.max(c.o, c.c));
            const h = Math.max(1, Math.abs(y(c.o) - y(c.c)));
            ctx.fillRect(cx - bodyW / 2, top, bodyW, h);
        });

        // volume, in the bottom fifth
        const volH = plotH * 0.18;
        let maxVol = 0;
        for (const c of candles) maxVol = Math.max(maxVol, c.v ?? 0);
        if (maxVol > 0) {
            candles.forEach((c, i) => {
                const cx = i * slot + slot / 2;
                const h = ((c.v ?? 0) / maxVol) * volH;
                ctx.fillStyle = (c.c >= c.o ? UP : DOWN) + '44';
                ctx.fillRect(cx - bodyW / 2, padTop + plotH - h, bodyW, h);
            });
        }

        // the newest price, marked on the axis
        const last = candles[candles.length - 1];
        const ly = Math.round(y(last.c)) + 0.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = last.c >= last.o ? UP : DOWN;
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(plotW, ly); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = last.c >= last.o ? UP : DOWN;
        ctx.fillRect(plotW + 4, ly - 9, padRight - 6, 18);
        ctx.fillStyle = '#0B0E13';
        ctx.fillText(last.c.toLocaleString('en-US', { maximumFractionDigits: 0 }), plotW + 8, ly);

        // entry and liquidation lines, when a position is open
        for (const line of lines) {
            if (!(line.price > lo && line.price < hi)) continue;
            const py = Math.round(y(line.price)) + 0.5;
            ctx.setLineDash(line.dash ?? [5, 4]);
            ctx.strokeStyle = line.colour;
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(plotW, py); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = line.colour;
            ctx.font = '10px "IBM Plex Sans", sans-serif';
            ctx.fillText(line.label, 6, py - 9);
            ctx.font = '11px "IBM Plex Mono", monospace';
        }
    }

    return {
        setCandles(next) { candles = next; draw(); },
        // Extend the newest candle, or start a new one when its minute rolls over.
        tick(price, minutes = 1) {
            if (!candles.length) return;
            const span = minutes * 60_000;
            const last = candles[candles.length - 1];
            const now = Date.now();
            if (now - last.t >= span) {
                candles.push({ t: last.t + span, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 });
                if (candles.length > 180) candles.shift();
            } else {
                last.c = price;
                last.h = Math.max(last.h, price);
                last.l = Math.min(last.l, price);
            }
            draw();
        },
        setLines(next) { lines = next; draw(); },
        resize,
    };
}

export const MARKERS = { entry: AMBER, liquidation: DOWN };
