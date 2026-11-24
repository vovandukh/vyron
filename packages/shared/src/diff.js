// Line diff of two texts (Myers, O((N+M)·D)) — instant for configs with small differences.
// Each line is tagged: ' ' common, '-' only in the old text (a), '+' only in the new one (b).

/** Full edit script: [{ t: ' '|'-'|'+', s: text, a: line in a (1-based), b: line in b (1-based) }]. */
export function diffLines(oldText, newText) {
  const a = String(oldText).replace(/\r\n/g, '\n').split('\n')
  const b = String(newText).replace(/\r\n/g, '\n').split('\n')
  // Common prefix and suffix first, Myers handles the rest
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf)
  const mid = myers(A, B)
  const ops = []
  let ia = 0, ib = 0
  const push = (t, s) => {
    ops.push({ t, s, a: t !== '+' ? ++ia : null, b: t !== '-' ? ++ib : null })
  }
  for (let i = 0; i < pre; i++) push(' ', a[i])
  for (const [t, s] of mid) push(t, s)
  for (let i = a.length - suf; i < a.length; i++) push(' ', a[i])
  return ops
}

function myers(A, B) {
  const n = A.length, m = B.length, max = n + m
  if (!n) return B.map(s => ['+', s])
  if (!m) return A.map(s => ['-', s])
  const off = max + 1
  let v = new Int32Array(2 * max + 3)
  const trace = []
  outer:
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && A[x] === B[y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) { trace.push(v.slice()); break outer }
    }
  }
  // Backtrack through the saved states
  const out = []
  let x = n, y = m
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d], k = x - y
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1
    const px = vv[off + prevK], py = px - prevK
    while (x > px && y > py) { out.push([' ', A[x - 1]]); x--; y-- }
    if (d > 0) {
      if (x === px) { out.push(['+', B[y - 1]]); y-- } else { out.push(['-', A[x - 1]]); x-- }
    }
  }
  while (x > 0 && y > 0) { out.push([' ', A[x - 1]]); x--; y-- }
  return out.reverse()
}

/** Number of added / removed lines. */
export const diffStat = ops => ops.reduce((s, o) => (o.t === '+' ? s.add++ : o.t === '-' ? s.del++ : 0, s), { add: 0, del: 0 })

/**
 * Collapses unchanged runs: keeps ctx lines of context around changes and replaces the rest with
 * { t: '…', n: hidden count }. No changes — empty array.
 */
export function diffHunks(ops, ctx = 3) {
  const keep = new Uint8Array(ops.length)
  ops.forEach((o, i) => {
    if (o.t === ' ') return
    for (let j = Math.max(0, i - ctx); j <= Math.min(ops.length - 1, i + ctx); j++) keep[j] = 1
  })
  const out = []
  let gap = 0
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (gap) { out.push({ t: '…', n: gap }); gap = 0 }
      out.push(o)
    } else gap++
  })
  if (gap && out.length) out.push({ t: '…', n: gap })
  return out
}
