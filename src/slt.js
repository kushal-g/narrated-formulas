// JavaScript port of the SLT parser from main.py

const COMMAND_SYMBOL = {
  "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ",
  "\\epsilon": "ε", "\\theta": "θ", "\\lambda": "λ", "\\mu": "μ",
  "\\pi": "π", "\\rho": "ρ", "\\sigma": "σ", "\\phi": "φ", "\\omega": "ω",
  "\\Delta": "Δ", "\\Sigma": "Σ", "\\Omega": "Ω", "\\Gamma": "Γ",
  "\\times": "×", "\\cdot": "·", "\\div": "÷", "\\pm": "±",
  "\\leq": "≤", "\\geq": "≥", "\\neq": "≠", "\\approx": "≈",
  "\\infty": "∞", "\\partial": "∂", "\\nabla": "∇",
  "\\rightarrow": "→", "\\leftarrow": "←", "\\Rightarrow": "⇒",
  "\\int": "∫", "\\sum": "∑", "\\prod": "∏", "\\sqrt": "√",
  "\\ldots": "…", "\\cdots": "⋯", "\\in": "∈", "\\forall": "∀",
  "\\exists": "∃", "\\equiv": "≡",
};

const PUNCTUATION = new Set([",", ".", ";", ":"]);

let _idCounter = 0;
function newId() { return ++_idCounter; }

function makeToken(kind, value = "", children = []) {
  return { kind, value, children };
}

function makeSLTNode(label) {
  return { label, edges: [], id: newId() };
}

function tokenize(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (c === "{") {
      let depth = 1, j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") depth--;
        j++;
      }
      const inner = s.slice(i + 1, j - 1);
      tokens.push(makeToken("group", "", tokenize(inner)));
      i = j;
    } else if (c === "^") {
      tokens.push(makeToken("sup"));
      i++;
    } else if (c === "_") {
      tokens.push(makeToken("sub"));
      i++;
    } else if (c === "\\") {
      const m = s.slice(i).match(/^\\([a-zA-Z]+|.)/);
      const cmd = m[0];
      i += cmd.length;
      if (cmd === "\\frac") tokens.push(makeToken("frac"));
      else if (cmd === "\\sqrt") tokens.push(makeToken("sqrt"));
      else tokens.push(makeToken("command", cmd));
    } else {
      tokens.push(makeToken("symbol", c));
      i++;
    }
  }
  return tokens;
}

function displayLabel(tok) {
  if (tok.kind === "command") return COMMAND_SYMBOL[tok.value] ?? tok.value;
  return tok.value;
}

function tail(node) {
  let cur = node;
  while (true) {
    const next = cur.edges.find(([r]) => r === "Right");
    if (!next) return cur;
    cur = next[1];
  }
}

function parseTokens(tokens) {
  let head = null;
  let prev = null;
  let i = 0;

  function link(node, relation) {
    if (!head) head = node;
    else if (prev) prev.edges.push([relation, node]);
    prev = node;
  }

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.kind === "frac") {
      const num = tokens[i + 1] ?? makeToken("group");
      const den = tokens[i + 2] ?? makeToken("group");
      const node = makeSLTNode("—");
      const numHead = parseTokens(num.kind === "group" ? num.children : [num]);
      const denHead = parseTokens(den.kind === "group" ? den.children : [den]);
      if (numHead) node.edges.push(["Above", numHead]);
      if (denHead) node.edges.push(["Below", denHead]);
      link(node, "Right");
      i += 3;
      continue;
    }

    if (tok.kind === "sqrt") {
      const arg = tokens[i + 1] ?? makeToken("group");
      const node = makeSLTNode("√");
      const argHead = parseTokens(arg.kind === "group" ? arg.children : [arg]);
      if (argHead) node.edges.push(["Inside", argHead]);
      link(node, "Right");
      i += i + 1 < tokens.length ? 2 : 1;
      continue;
    }

    if (tok.kind === "group") {
      const innerHead = parseTokens(tok.children);
      if (innerHead) {
        link(innerHead, "Right");
        prev = tail(innerHead);
      }
      i++;
      continue;
    }

    if (tok.kind === "symbol" || tok.kind === "command") {
      const node = makeSLTNode(displayLabel(tok));
      const relation = PUNCTUATION.has(tok.value) ? "Punc" : "Right";
      link(node, relation);
      i++;
      continue;
    }

    if (tok.kind === "sup") {
      const target = tokens[i + 1] ?? makeToken("group");
      const supHead = parseTokens(target.kind === "group" ? target.children : [target]);
      if (prev && supHead) prev.edges.push(["Sup", supHead]);
      i += 2;
      continue;
    }

    if (tok.kind === "sub") {
      const target = tokens[i + 1] ?? makeToken("group");
      const subHead = parseTokens(target.kind === "group" ? target.children : [target]);
      if (prev && subHead) prev.edges.push(["Sub", subHead]);
      i += 2;
      continue;
    }

    i++;
  }

  return head;
}

export function latexToSlt(latex) {
  _idCounter = 0;
  const tokens = tokenize(latex);
  return parseTokens(tokens);
}

// --- Narration support ---

function sltChainsMatch(node, termNode) {
  if (!node || !termNode) return !node && !termNode;
  if (node.label !== termNode.label) return false;
  for (const [rel, termChild] of termNode.edges) {
    if (rel === 'Right') continue;
    const edge = node.edges.find(([r]) => r === rel);
    if (!edge || !sltChainsMatch(edge[1], termChild)) return false;
  }
  const termRight = termNode.edges.find(([r]) => r === 'Right');
  if (!termRight) return true;
  const nodeRight = node.edges.find(([r]) => r === 'Right');
  if (!nodeRight) return false;
  return sltChainsMatch(nodeRight[1], termRight[1]);
}

export function findTermInSlt(fullSlt, termSlt, pos = 1) {
  let count = 0;
  let node = fullSlt;
  while (node) {
    if (sltChainsMatch(node, termSlt)) {
      count++;
      if (count === pos) return node;
    }
    const right = node.edges.find(([r]) => r === 'Right');
    node = right ? right[1] : null;
  }
  return null;
}

export function annotateNarrations(fullSlt, narrations) {
  for (let i = 0; i < narrations.length; i++) {
    const { term, pos } = narrations[i];
    const targetPos = pos ? parseInt(pos, 10) : 1;
    const termSlt = parseTokens(tokenize(term));
    const matched = findTermInSlt(fullSlt, termSlt, targetPos);
    if (matched) matched.narrationIdx = i;
  }
  return fullSlt;
}

export function splitFormulaAtTerms(data) {
  const { latex, narrations = [] } = data;
  const positions = (narrations ?? []).map(({ term, pos }, i) => {
    const targetPos = pos ? parseInt(pos, 10) : 1;
    let count = 0, idx = 0;
    while (idx <= latex.length - term.length) {
      const found = latex.indexOf(term, idx);
      if (found === -1) return null;
      if (++count === targetPos) return { i, start: found, end: found + term.length };
      idx = found + 1;
    }
    return null;
  }).filter(Boolean).sort((a, b) => a.start - b.start);

  const chunks = [];
  let cursor = 0;
  for (const { i, start, end } of positions) {
    if (start > cursor) chunks.push({ type: 'sep', latex: latex.slice(cursor, start) });
    chunks.push({ type: 'term', index: i, latex: narrations[i].term });
    cursor = end;
  }
  if (cursor < latex.length) chunks.push({ type: 'sep', latex: latex.slice(cursor) });
  return chunks;
}
