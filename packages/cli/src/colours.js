// Minimal ANSI colour helper — replaces chalk dependency.
// Avoids ESM/CJS compatibility issues entirely.

const enabled = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;

function wrap(open, close) {
  return (str) => enabled ? `\x1b[${open}m${str}\x1b[${close}m` : String(str);
}

const c = {
  bold:    wrap('1', '22'),
  dim:     wrap('2', '22'),
  red:     wrap('31', '39'),
  green:   wrap('32', '39'),
  yellow:  wrap('33', '39'),
  cyan:    wrap('36', '39'),
};

module.exports = c;
