/** Puerts' V8 is built without ICU, so `Intl` is missing and toLocaleString() prints raw numbers and
 *  dates ("6528", "Sat Oct 10 2026 14:05:09 GMT-0700"). This is an en-US subset of Intl and of the
 *  toLocale* methods, installed only when Intl is missing: grouped and fixed-digit numbers, percent,
 *  currency and compact notation, dates and times, plural rules, collation, relative time and lists. */
const g = globalThis as Record<string, any>;

type NumberOptions = {style?: string; currency?: string; unit?: string; minimumFractionDigits?: number; maximumFractionDigits?: number;
  minimumIntegerDigits?: number; maximumSignificantDigits?: number; useGrouping?: boolean | string; notation?: string; signDisplay?: string};
const CURRENCY: Record<string, string> = {USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$'};
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function formatNumber(x: number, o: NumberOptions = {}): string {
  if (Number.isNaN(x)) return 'NaN';
  const style = o.style ?? 'decimal';
  let v = style === 'percent' ? x * 100 : x, suffix = '';
  if (!Number.isFinite(v)) return (v < 0 ? '-' : '') + '∞';
  let min = o.minimumFractionDigits ?? (style === 'currency' ? 2 : 0);
  let max = Math.max(min, o.maximumFractionDigits ?? (style === 'currency' ? 2 : style === 'percent' ? 0 : 3));
  if (o.notation === 'compact') {
    for (const [n, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as [number, string][]) if (Math.abs(v) >= n) { v /= n; suffix = s; break; }
    // Compact numbers keep two significant digits: 1.5M, 15K, 150K.
    if (o.maximumFractionDigits === undefined) { min = 0; max = Math.abs(v) < 10 ? 1 : 0; }
  }
  let digits = o.maximumSignificantDigits ? String(Number(Math.abs(v).toPrecision(o.maximumSignificantDigits))) : Math.abs(v).toFixed(max);
  let [int, frac = ''] = digits.split('.');
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  if (o.minimumIntegerDigits) int = int.padStart(o.minimumIntegerDigits, '0');
  if (o.useGrouping !== false && o.useGrouping !== 'false') int = group(int);
  digits = (frac ? int + '.' + frac : int) + suffix;
  const zero = /^[0.,]*$/.test(int + frac);
  const sign = v < 0 ? (o.signDisplay === 'never' || (o.signDisplay === 'exceptZero' && zero) ? '' : '-') : (o.signDisplay === 'always' || (o.signDisplay === 'exceptZero' && !zero)) ? '+' : '';
  if (style === 'currency') { const c = (o.currency ?? 'USD').toUpperCase(); return sign + (CURRENCY[c] ?? c + ' ') + digits; }
  if (style === 'percent') return sign + digits + '%';
  if (style === 'unit' && o.unit) return sign + digits + ' ' + o.unit;
  return sign + digits;
}

type DateOptions = {weekday?: string; era?: string; year?: string; month?: string; day?: string; hour?: string; minute?: string; second?: string;
  hour12?: boolean; hourCycle?: string; timeZone?: string; dateStyle?: string; timeStyle?: string; timeZoneName?: string; fractionalSecondDigits?: number};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const name = (list: string[], i: number, width = 'long') => width === 'long' ? list[i] : width === 'narrow' ? list[i][0] : list[i].slice(0, 3);

function expand(o: DateOptions, defaults: 'date' | 'time' | 'all'): DateOptions {
  const has = o.weekday || o.year || o.month || o.day || o.hour || o.minute || o.second || o.dateStyle || o.timeStyle;
  if (has) {
    const s = {...o};
    if (o.dateStyle === 'full') Object.assign(s, {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'});
    if (o.dateStyle === 'long') Object.assign(s, {month: 'long', day: 'numeric', year: 'numeric'});
    if (o.dateStyle === 'medium') Object.assign(s, {month: 'short', day: 'numeric', year: 'numeric'});
    if (o.dateStyle === 'short') Object.assign(s, {month: 'numeric', day: 'numeric', year: '2-digit'});
    if (o.timeStyle === 'short') Object.assign(s, {hour: 'numeric', minute: '2-digit'});
    if (o.timeStyle && o.timeStyle !== 'short') Object.assign(s, {hour: 'numeric', minute: '2-digit', second: '2-digit'});
    return s;
  }
  const date = {year: 'numeric', month: 'numeric', day: 'numeric'}, time = {hour: 'numeric', minute: '2-digit', second: '2-digit'};
  return {...o, ...(defaults === 'date' ? date : defaults === 'time' ? time : {...date, ...time})};
}

function formatDate(d: Date, opts: DateOptions = {}, defaults: 'date' | 'time' | 'all' = 'all'): string {
  if (Number.isNaN(d.getTime())) return 'Invalid Date';
  const o = expand(opts, defaults), utc = (o.timeZone ?? '').toUpperCase() === 'UTC';
  const Y = utc ? d.getUTCFullYear() : d.getFullYear(), M = utc ? d.getUTCMonth() : d.getMonth(), D = utc ? d.getUTCDate() : d.getDate();
  const W = utc ? d.getUTCDay() : d.getDay(), h = utc ? d.getUTCHours() : d.getHours(), m = utc ? d.getUTCMinutes() : d.getMinutes(), s = utc ? d.getUTCSeconds() : d.getSeconds();
  const year = o.year === '2-digit' ? pad2(Y % 100) : o.year ? String(Y) : '';
  const day = o.day === '2-digit' ? pad2(D) : o.day ? String(D) : '';
  let date = '';
  if (o.month && !/^(numeric|2-digit)$/.test(o.month)) {
    const mon = name(MONTHS, M, o.month);
    date = day ? `${mon} ${day}` : mon;
    if (year) date += day ? `, ${year}` : ` ${year}`;
  } else if (o.month || day) {
    const mon = o.month === '2-digit' ? pad2(M + 1) : o.month ? String(M + 1) : '';
    date = [mon, day, year].filter(Boolean).join('/');
  } else date = year;
  if (o.weekday) date = date ? `${name(DAYS, W, o.weekday)}, ${date}` : name(DAYS, W, o.weekday);
  let time = '';
  if (o.hour || o.minute || o.second) {
    const twelve = o.hour12 ?? !(o.hourCycle === 'h23' || o.hourCycle === 'h24');
    const hh = twelve ? (h % 12 || 12) : h;
    const parts = [o.hour ? (o.hour === '2-digit' || !twelve ? pad2(hh) : String(hh)) : '', o.minute ? (o.hour ? pad2(m) : String(m)) : '', o.second ? (o.minute ? pad2(s) : String(s)) : ''].filter(Boolean);
    if (o.second && o.fractionalSecondDigits) parts[parts.length - 1] += '.' + String((utc ? d.getUTCMilliseconds() : d.getMilliseconds())).padStart(3, '0').slice(0, o.fractionalSecondDigits);
    time = parts.join(':') + (o.hour && twelve ? (h < 12 ? ' AM' : ' PM') : '');
    if (o.timeZoneName) time += utc ? ' UTC' : '';
  }
  return date && time ? `${date}, ${time}` : date || time;
}

class NumberFormat {
  private o: NumberOptions;
  constructor(_locale?: unknown, options: NumberOptions = {}) { this.o = {...options}; }
  format = (x: number | bigint) => formatNumber(Number(x), this.o);
  formatToParts(x: number) { return [{type: 'literal', value: this.format(x)}]; }
  resolvedOptions() { return {locale: 'en-US', numberingSystem: 'latn', style: this.o.style ?? 'decimal', ...this.o}; }
  static supportedLocalesOf() { return ['en-US']; }
}
class DateTimeFormat {
  private o: DateOptions;
  constructor(_locale?: unknown, options: DateOptions = {}) { this.o = {...options}; }
  format = (d?: Date | number) => formatDate(d === undefined ? new Date() : new Date(d), this.o, 'date');
  formatToParts(d?: Date | number) { return [{type: 'literal', value: this.format(d)}]; }
  formatRange(a: Date, b: Date) { return `${this.format(a)} – ${this.format(b)}`; }
  resolvedOptions() { return {locale: 'en-US', calendar: 'gregory', numberingSystem: 'latn', timeZone: this.o.timeZone ?? 'UTC', ...this.o}; }
  static supportedLocalesOf() { return ['en-US']; }
}
class PluralRules {
  constructor(_locale?: unknown, private o: {type?: string} = {}) {}
  select(n: number) {
    if (this.o.type !== 'ordinal') return n === 1 ? 'one' : 'other';
    const t = n % 10, h = n % 100;
    return t === 1 && h !== 11 ? 'one' : t === 2 && h !== 12 ? 'two' : t === 3 && h !== 13 ? 'few' : 'other';
  }
  resolvedOptions() { return {locale: 'en-US', type: this.o.type ?? 'cardinal'}; }
  static supportedLocalesOf() { return ['en-US']; }
}
class Collator {
  constructor(_locale?: unknown, private o: {numeric?: boolean; sensitivity?: string} = {}) {}
  compare = (a: string, b: string) => {
    let x = String(a), y = String(b);
    if (this.o.sensitivity === 'base' || this.o.sensitivity === 'accent') { x = x.toLowerCase(); y = y.toLowerCase(); }
    if (this.o.numeric) {
      const re = /(\d+)|(\D+)/g, xs = x.match(re) ?? [], ys = y.match(re) ?? [];
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
        const p = xs[i], q = ys[i], np = /^\d/.test(p), nq = /^\d/.test(q);
        const c = np && nq ? Number(p) - Number(q) : p < q ? -1 : p > q ? 1 : 0;
        if (c) return Math.sign(c);
      }
      return Math.sign(xs.length - ys.length);
    }
    return x < y ? -1 : x > y ? 1 : 0;
  };
  resolvedOptions() { return {locale: 'en-US', ...this.o}; }
}
class RelativeTimeFormat {
  constructor(_locale?: unknown, private o: {numeric?: string} = {}) {}
  format(v: number, unit: string) {
    const u = unit.replace(/s$/, ''), n = Math.abs(v);
    if (this.o.numeric === 'auto' && n <= 1 && u === 'day') return v === 0 ? 'today' : v > 0 ? 'tomorrow' : 'yesterday';
    const label = `${formatNumber(n)} ${u}${n === 1 ? '' : 's'}`;
    return v < 0 || Object.is(v, -0) ? `${label} ago` : `in ${label}`;
  }
}
class ListFormat {
  constructor(_locale?: unknown, private o: {type?: string} = {}) {}
  format(list: Iterable<string>) {
    const a = [...list], and = this.o.type === 'disjunction' ? 'or' : 'and';
    return a.length < 2 ? a.join('') : a.length === 2 ? `${a[0]} ${and} ${a[1]}` : `${a.slice(0, -1).join(', ')}, ${and} ${a[a.length - 1]}`;
  }
}

if (typeof g.Intl === 'undefined') {
  g.Intl = {NumberFormat, DateTimeFormat, PluralRules, Collator, RelativeTimeFormat, ListFormat, getCanonicalLocales: () => ['en-US'], supportedValuesOf: () => []};
  const define = (o: object, k: string, f: unknown) => Object.defineProperty(o, k, {value: f, writable: true, configurable: true});
  define(Number.prototype, 'toLocaleString', function (this: number, _l?: unknown, o?: NumberOptions) { return formatNumber(Number(this), o); });
  define(BigInt.prototype, 'toLocaleString', function (this: bigint, _l?: unknown, o?: NumberOptions) { return formatNumber(Number(this), o); });
  define(Date.prototype, 'toLocaleString', function (this: Date, _l?: unknown, o?: DateOptions) { return formatDate(this, o, 'all'); });
  define(Date.prototype, 'toLocaleDateString', function (this: Date, _l?: unknown, o?: DateOptions) { return formatDate(this, o, 'date'); });
  define(Date.prototype, 'toLocaleTimeString', function (this: Date, _l?: unknown, o?: DateOptions) { return formatDate(this, o, 'time'); });
}
