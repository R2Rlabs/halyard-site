// Checks the Arena moves from one season to the next on the clock alone.
// Usage: node seasons.test.mjs
import { SEASONS, seasonAt } from './arena.js';

const at = (iso) => Date.parse(iso);
const name = (ts) => seasonAt(ts)?.id ?? 'closed';

const cases = [
    ['2026-09-26T23:59:00Z', 'closed', 'the minute before season one'],
    ['2026-09-27T00:00:00Z', 's1', 'season one opens'],
    ['2026-10-05T12:00:00Z', 's1', 'mid season one'],
    ['2026-10-10T23:59:00Z', 's1', 'the last minute of season one'],
    ['2026-10-11T00:00:00Z', 'closed', 'season one shuts'],
    ['2026-10-14T12:00:00Z', 'closed', 'the gap between seasons'],
    ['2026-10-16T16:59:00Z', 'closed', 'the minute before the weekend'],
    ['2026-10-16T17:00:00Z', 's2', 'the weekend opens, Friday evening'],
    ['2026-10-17T12:00:00Z', 's2', 'Saturday'],
    ['2026-10-18T22:59:00Z', 's2', 'the last minute of the weekend'],
    ['2026-10-18T23:00:00Z', 'closed', 'the weekend shuts'],
    ['2026-11-01T00:00:00Z', 'closed', 'after every season'],
];

let failed = 0;
for (const [iso, want, why] of cases) {
    const got = name(at(iso));
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${iso}  ${String(got).padEnd(7)} ${why}`);
}

// Seasons must not overlap, or a trade could belong to two tables at once.
for (let i = 1; i < SEASONS.length; i++) {
    const previous = SEASONS[i - 1];
    const next = SEASONS[i];
    const ok = Date.parse(next.startsAt) >= Date.parse(previous.endsAt);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${previous.id} ends before ${next.id} starts`);
}

// A weekend should be a weekend.
const weekend = SEASONS.find((s) => s.id === 's2');
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const opensOn = days[new Date(weekend.startsAt).getUTCDay()];
const closesOn = days[new Date(weekend.endsAt).getUTCDay()];
const weekendOk = opensOn === 'Friday' && closesOn === 'Sunday';
if (!weekendOk) failed++;
console.log(`${weekendOk ? 'ok  ' : 'FAIL'}  season two opens ${opensOn} and closes ${closesOn}`);

const hours = (Date.parse(weekend.endsAt) - Date.parse(weekend.startsAt)) / 3600000;
console.log(`      season two is ${hours} hours long`);

console.log(failed ? `\n${failed} failed` : '\nall good');
process.exit(failed ? 1 : 0);
