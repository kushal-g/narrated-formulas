import { computeMuMap } from './spacingTransform.js';

// Unicode codepoints (decimal) for PEMDAS operators as MathJax encodes them in data-c (hex)
// These are the Unicode values of the characters MathJax renders for each operator.
const MO_PEMDAS_LEVEL = {
  0x2B:   1,  // + (PLUS SIGN)
  0x2212: 1,  // − (MINUS SIGN U+2212, what MathJax uses for binary minus)
  0x2D:   1,  // - (HYPHEN-MINUS, fallback)
  0xB1:   1,  // ± \pm
  0x2213: 1,  // ∓ \mp
  0x22C5: 2,  // ⋅ \cdot (DOT OPERATOR)
  0x2217: 2,  // ∗ ASTERISK OPERATOR — what MathJax renders for *
  0xD7:   2,  // × \times
  0xF7:   2,  // ÷ \div
  0x2F:   2,  // / (SOLIDUS)
  0x2A:   2,  // * (plain ASCII asterisk, fallback)
  0x2E:   2,  // . (FULL STOP used as multiplication)
};

const MO_REL = new Set([
  0x3D,   // =
  0x3C,   // <
  0x3E,   // >
  0x2264, // ≤ \leq
  0x2265, // ≥ \geq
  0x2260, // ≠ \neq
  0x2248, // ≈ \approx
  0x2261, // ≡ \equiv
  0x223C, // ∼ \sim
  0x2245, // ≅ \cong
  0x221D, // ∝ \propto
  // alternate encodings MathJax may use
  0x2A7D, // ⩽ (variant \leq)
  0x2A7E, // ⩾ (variant \geq)
]);

const REL_MU = 30;

// Scoped nodes: treat as atomic operands — don't recurse for outer spacing
const OPAQUE_NODES = new Set([
  'mfrac', 'msup', 'msub', 'msubsup',
  'mroot', 'mover', 'munder', 'munderover',
  'mtext', 'ms', 'mspace',
]);

// ─── SVG element helpers ───────────────────────────────────────────────────────

function getTranslateX(el) {
  const t = el.getAttribute('transform') || '';
  const m = t.match(/translate\(\s*([-\d.e]+)/i);
  return m ? parseFloat(m[1]) : 0;
}

function setTranslateX(el, newX) {
  const t = el.getAttribute('transform') || '';
  // "translate(x, y)" or "translate(x,y)"
  const full = t.match(/^(.*?)translate\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)(.*?)$/i);
  if (full) {
    el.setAttribute('transform', `${full[1]}translate(${newX}, ${full[3]})${full[4]}`);
    return;
  }
  // "translate(x)"
  const simple = t.match(/^(.*?)translate\(\s*([-\d.e]+)\s*\)(.*?)$/i);
  if (simple) {
    el.setAttribute('transform', `${simple[1]}translate(${newX})${simple[3]}`);
    return;
  }
  el.setAttribute('transform', `translate(${newX}, 0)`);
}

// Get the unicode codepoint of the glyph inside a <g data-mml-node="mo"> element.
// MathJax encodes it as the data-c attribute (hex) on the <use> child.
function getMoCodepoint(moEl) {
  const useEl = moEl.querySelector('use');
  if (!useEl) return null;
  const dataC = useEl.getAttribute('data-c');
  if (!dataC) return null;
  return parseInt(dataC, 16);
}

// Derive how many SVG coordinate units equal 1 mu, from the SVG's viewBox + width.
// MathJax sets width in "ex" and the viewBox in internal units where
//   1 ex = viewBoxWidth / widthInEx  SVG units
// 1 mu = (1/18) em.  Using standard Computer Modern ex/em ≈ 0.431:
//   1 mu = 0.431/18 ex
function computeMuScale(svgEl) {
  const vbStr = svgEl.getAttribute('viewBox');
  if (!vbStr) return 55; // fallback: empirical default
  const vbParts = vbStr.trim().split(/\s+/).map(Number);
  const vbW = vbParts[2];

  const widthAttr = svgEl.getAttribute('width') || '';
  const exWidth = parseFloat(widthAttr); // expects "X.Xex"
  if (!exWidth || isNaN(exWidth) || !vbW) return 55;

  const svgUnitsPerEx = vbW / exWidth;
  return (0.431 / 18) * svgUnitsPerEx;
}

// ─── Core spacing pass ─────────────────────────────────────────────────────────

// Spaces the direct g[data-mml-node] children of mrowEl.
// Returns the total extra SVG units added (so callers can update viewBox width).
function spaceMrow(mrowEl, muMap, muScale, inParen) {
  const children = Array.from(mrowEl.children).filter(
    el => el.tagName === 'g' && el.hasAttribute('data-mml-node')
  );
  if (children.length === 0) return 0;

  // Save original x-positions before any modification
  const origX = children.map(getTranslateX);

  let offset = 0;      // cumulative SVG units added left of current position
  let prevType = 'start'; // 'start' | 'operand' | 'operator'
  let totalAdded = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const node = child.getAttribute('data-mml-node');

    // Resolve the operator codepoint: either from a direct mo, or from a
    // TeXAtom that wraps a single mo (MathJax boxes / and other Ord-class
    // characters inside TeXAtom even when used as binary operators).
    const isMoLike = node === 'mo' || node === 'TeXAtom';
    const cp = isMoLike
      ? (node === 'mo'
          ? getMoCodepoint(child)
          : getMoCodepoint(child.querySelector('g[data-mml-node="mo"]')))
      : null;

    if (isMoLike && cp !== null) {
      const pemdasLevel = MO_PEMDAS_LEVEL[cp];
      const isRel = MO_REL.has(cp);

      if ((pemdasLevel !== undefined || isRel) && prevType === 'operand') {
        const mu = isRel ? REL_MU : (muMap[pemdasLevel] ?? 5);
        const extra = mu * muScale;
        setTranslateX(child, origX[i] + offset + extra);
        offset += 2 * extra;
        totalAdded += 2 * extra;
        prevType = 'operator';
      } else {
        setTranslateX(child, origX[i] + offset);
        const isClose = cp === 0x29 || cp === 0x5D || cp === 0x7D;
        prevType = isClose ? 'operand' : 'operator';
      }
    } else if (isMoLike) {
      // mo/TeXAtom with no recognised codepoint — shift only, treat as operand
      setTranslateX(child, origX[i] + offset);
      prevType = 'operand';
    } else if (OPAQUE_NODES.has(node)) {
      setTranslateX(child, origX[i] + offset);
      prevType = 'operand';
    } else {
      // Transparent node (mrow, mstyle, mpadded, mphantom, …): shift and recurse
      setTranslateX(child, origX[i] + offset);
      if (node === 'mrow') {
        // Recurse into nested mrow — detect paren context from the preceding sibling mo
        // For now treat all inner mrows as in-paren to use reduced spacing
        spaceMrow(child, muMap, muScale, true);
        // Note: inner shifts are relative to the inner mrow's coordinate frame,
        // so they don't affect sibling positions here.
      }
      prevType = 'operand';
    }
  }

  return totalAdded;
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Mutates the SVG DOM node returned by MathJax.tex2svgPromise to apply
// PEMDAS-aware operator spacing, mirroring what spacingTransform.js injects
// into LaTeX via \mspace{}.
export function applyPemdasSpacingToSvg(containerNode, latex) {
  const svgEl = containerNode.tagName?.toLowerCase() === 'svg'
    ? containerNode
    : containerNode.querySelector('svg');
  if (!svgEl) return;

  const { muMap } = computeMuMap(latex);

  const muScale = computeMuScale(svgEl);

  const mathG = svgEl.querySelector('g[data-mml-node="math"]');
  if (!mathG) return;

  // Unwrap mstyle if present (MathJax sometimes inserts it)
  let container = mathG;
  const mstyleChild = Array.from(mathG.children).find(
    el => el.tagName === 'g' && el.getAttribute('data-mml-node') === 'mstyle'
  );
  if (mstyleChild) container = mstyleChild;

  // If the container has a single mrow child, use that (it's the formula wrapper).
  // Otherwise use the container itself (math or mstyle), which holds the top-level elements directly.
  const gChildren = Array.from(container.children).filter(
    el => el.tagName === 'g' && el.hasAttribute('data-mml-node')
  );
  const topMrow = (gChildren.length === 1 && gChildren[0].getAttribute('data-mml-node') === 'mrow')
    ? gChildren[0]
    : container;

  // Save original viewBox width before mutating
  const vbStr = svgEl.getAttribute('viewBox');
  let vbParts = vbStr ? vbStr.trim().split(/\s+/).map(Number) : null;
  const origVbW = vbParts ? vbParts[2] : 0;

  const totalAdded = spaceMrow(topMrow, muMap, muScale, false);
  if (totalAdded === 0 || !vbParts) return;

  // Widen viewBox
  vbParts[2] = origVbW + totalAdded;
  svgEl.setAttribute('viewBox', vbParts.join(' '));

  // Widen the width attribute proportionally (keeps physical ex size correct)
  const widthAttr = svgEl.getAttribute('width') || '';
  const exWidth = parseFloat(widthAttr);
  const unit = widthAttr.replace(/[\d.]+/, '') || 'ex';
  if (exWidth && origVbW) {
    const newExWidth = exWidth * vbParts[2] / origVbW;
    svgEl.setAttribute('width', `${newExWidth.toFixed(3)}${unit}`);
  }
}
