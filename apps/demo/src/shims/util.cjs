// The subset of Node's util used by @nestjs/common and friends.
function inspect(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function format(fmt, ...args) {
  if (typeof fmt !== 'string') return [fmt, ...args].map(inspect).join(' ');
  let i = 0;
  const out = fmt.replace(/%[sdifjoO%]/g, (m) => (m === '%%' ? '%' : i < args.length ? inspect(args[i++]) : m));
  return [out, ...args.slice(i).map(inspect)].join(' ');
}
function inherits(ctor, superCtor) {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  Object.setPrototypeOf(ctor, superCtor);
}
function promisify(fn) {
  return (...args) => new Promise((resolve, reject) => fn(...args, (err, v) => (err ? reject(err) : resolve(v))));
}
function isDeepStrictEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}
module.exports = {
  inspect,
  format,
  inherits,
  promisify,
  isDeepStrictEqual,
  deprecate: (fn) => fn,
  debuglog: () => () => undefined,
  types: { isPromise: (v) => v instanceof Promise },
  TextEncoder,
  TextDecoder,
};
