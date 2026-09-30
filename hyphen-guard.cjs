// Regression guard: hyphen-heavy code must pass server text processing byte-identical.
// Run: node hyphen-guard.cjs (exit 0 = pass). Covers scrubCutoffDisclaimers,
// scrubIdentityLeaks (both tiers) and makeThinkSplitter incl. chunk boundaries.
const fs = require('fs');
const path = require('path');
const svsrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function nextBalanced(from, open, close) {
  // brace/bracket matcher aware of strings, template literals and regex literals
  let depth = 0, k = from, instr = null, inre = false, inclass = false, prev = '';
  for (; k < svsrc.length; k++) {
    const ch = svsrc[k];
    if (instr) { if (ch === instr && svsrc[k - 1] !== '\\') instr = null; continue; }
    if (inre) {
      if (ch === '\\') { k++; continue; }
      if (ch === '[') inclass = true;
      else if (ch === ']') inclass = false;
      else if (ch === '/' && !inclass) inre = false;
      continue;
    }
    // skip comments before quote/regex detection (comment text may quote)
    if (ch === '/' && svsrc[k + 1] === '/') { const nl = svsrc.indexOf('\n', k); k = nl === -1 ? svsrc.length : nl; continue; }
    if (ch === '/' && svsrc[k + 1] === '*') { const ec = svsrc.indexOf('*/', k + 2); k = ec === -1 ? svsrc.length : ec + 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { instr = ch; continue; }
    if (ch === '/' && svsrc[k + 1] !== '/' && svsrc[k + 1] !== '*') {
      const p = prev.replace(/\s+$/, '').slice(-1);
      const pw = (prev.match(/[A-Za-z_$][A-Za-z0-9_$]*$/) || [''])[0];
      if (!p || '=(:,[!&|?{};,+-*%^~<>'.includes(p) || /^(return|typeof|in|of|new|delete|void|instanceof|await|yield|do|else)$/.test(pw)) { inre = true; inclass = false; continue; }
    }
    if (ch === open) depth++;
    if (ch === close) { depth--; if (!depth) return k; }
    if (ch.trim()) prev = ch;
  }
  throw new Error('unbalanced');
}
function grabFn(name) {
  const i = svsrc.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('missing ' + name);
  return svsrc.slice(i, nextBalanced(svsrc.indexOf('{', i), '{', '}') + 1);
}
function grabArr(name) {
  const i = svsrc.indexOf('const ' + name + ' =');
  if (i === -1) throw new Error('missing ' + name);
  const end = nextBalanced(svsrc.indexOf('[', i), '[', ']');
  return svsrc.slice(i, svsrc.indexOf(';', end) + 1);
}
function grabConst(name) {
  const i = svsrc.indexOf('const ' + name + ' =');
  if (i === -1) throw new Error('missing ' + name);
  return svsrc.slice(i, svsrc.indexOf(';', i) + 1);
}

eval(
  grabArr('CUTOFF_LEAK_PATTERNS') + '\n'
  + grabArr('IDENTITY_LEAK_PATTERNS') + '\n'
  + grabConst('MAX_LEAK_WATCH_LEN') + '\n'
  + grabFn('scrubCutoffDisclaimers') + '\n'
  + grabFn('scrubIdentityLeaks') + '\n'
  + grabFn('displayNameForTier') + '\n'
  + grabFn('makeThinkSplitter') + '\n'
  + grabFn('makeIdentityFilter')
);

const MUST_KEEP = ['-4.8', '-1', '-0.5', 'touch-action', 'H - GROUND_H', 'p.x -= SPEED', '-webkit-transform', 'a-b', 'x -= 1', '--flag', 'a--b'];
const probe = 'const SPEED = -4.8;\nreset (-1, -0.5);\ncanvas.style.touchAction = "none";\n// touch-action H - GROUND_H\np.x -= SPEED;\nconst el = document.querySelector("a-b"); // -webkit-transform\nx -= 1;\nrun --flag test;\nlet a--b;';
let fail = 0;
const check = (label, out) => {
  for (const s of MUST_KEEP) {
    if (!out.includes(s)) { console.log('FAIL', label, 'lost', JSON.stringify(s)); fail++; }
  }
};
// 1. whole-string scrubs, both tiers
for (const tier of ['flash', 'pro']) {
  check('cutoff/' + tier, scrubCutoffDisclaimers(probe));
  check('identity/' + tier, scrubIdentityLeaks(probe, tier));
}
// 2. streaming filter at hostile chunk boundaries (split mid-token everywhere)
for (let width = 1; width <= 24; width++) {
  for (const tier of ['flash', 'pro']) {
    const f = makeIdentityFilter(tier);
    let acc = '';
    for (let i = 0; i < probe.length; i += width) acc += f.process(probe.slice(i, i + width));
    acc += f.flush();
    const tag = `stream/w${width}/${tier}`;
    for (const s of MUST_KEEP) {
      if (!acc.includes(s)) { console.log('FAIL', tag, 'lost', JSON.stringify(s)); fail++; }
    }
  }
}
// 3. think splitter round-trips content (incl. <think> blocks)
{
  const t = makeThinkSplitter();
  const input = 'before <think>hmm - really - ok</think> after -4.8 x -= 1';
  const r1 = t.process(input);
  const r2 = t.flush();
  const all = r1.reasoning + r1.content + r2.reasoning + r2.content;
  for (const s of ['hmm - really - ok', 'after -4.8 x -= 1']) {
    if (!all.includes(s)) { console.log('FAIL think-splitter lost', JSON.stringify(s)); fail++; }
  }
}
console.log(fail ? `FAILED (${fail})` : 'ALL HYPHEN CHECKS PASSED');
process.exit(fail ? 1 : 0);
