// PEMDAS operator levels (lower number = lower priority = more spacing)
const PEMDAS_LEVEL = {
  '+': 1, '-': 1, '\\pm': 1, '\\mp': 1,
  '*': 2, '/': 2, '.': 2, '\\cdot': 2, '\\times': 2, '\\div': 2,
};

const REL_CHARS = new Set(['=', '<', '>']);
const REL_CMDS  = new Set(['\\leq', '\\geq', '\\le', '\\ge', '\\neq', '\\ne',
  '\\approx', '\\equiv', '\\sim', '\\cong', '\\propto']);
const REL_MU = 15;

const TEXT_CMDS = new Set(['\\text', '\\mathrm', '\\mathbf', '\\mathit',
  '\\mathsf', '\\mathtt', '\\mathbb', '\\mathcal', '\\mathscr']);

// Known commands and their brace-group argument counts.
// Argument groups are independent sub-expressions — their operators don't
// bleed into the enclosing scope during the scan pass.
const CMD_ARITY = {
  '\\frac': 2, '\\dfrac': 2, '\\tfrac': 2, '\\cfrac': 2,
  '\\binom': 2, '\\dbinom': 2, '\\tbinom': 2,
  '\\overset': 2, '\\underset': 2, '\\stackrel': 2,
  '\\sqrt': 1,
  '\\hat': 1, '\\bar': 1, '\\vec': 1, '\\dot': 1, '\\ddot': 1,
  '\\tilde': 1, '\\widehat': 1, '\\widetilde': 1,
  '\\overline': 1, '\\underline': 1, '\\overbrace': 1, '\\underbrace': 1,
};

// Spacing (mu per side) for N distinct PEMDAS levels at a scope.
// Row index = N-1. Within a row, index 0 = lowest-priority = most spacing.
const MU_TABLE = [
  [12],         // 1 level  — moderate
  [20, 3],      // 2 levels — dramatic contrast
  [22, 9, 2],   // 3 levels
];

// Reduced table for the interior of ( ) groups.
// Operators inside a paren group are subordinate; smaller spacing signals the
// entire group is a single unit at the outer level.
const MU_TABLE_PAREN = [
  [7],          // 1 level
  [11, 2],      // 2 levels
  [13, 5, 1],   // 3 levels
];

function tableMu(table, N, rank) {
  const row = table[Math.min(N, table.length) - 1];
  return row[Math.min(rank, row.length - 1)];
}

// ─── tokenizer ────────────────────────────────────────────────────────────────

function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { toks.push({ type: 'char', text: ' ' }); i++; continue; }
    if (c === '{') {
      let depth = 1, j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth++; else if (s[j] === '}') depth--;
        j++;
      }
      toks.push({ type: 'group', inner: tokenize(s.slice(i + 1, j - 1)) });
      i = j;
    } else if (c === '^') {
      toks.push({ type: 'sup' }); i++;
    } else if (c === '_') {
      toks.push({ type: 'sub' }); i++;
    } else if (c === '\\') {
      const m = s.slice(i).match(/^\\([a-zA-Z]+|.)/);
      toks.push({ type: 'cmd', text: m[0] });
      i += m[0].length;
    } else {
      toks.push({ type: 'char', text: c }); i++;
    }
  }
  return toks;
}

// ─── paren grouper ────────────────────────────────────────────────────────────
// Converts ( ... ) and \left( ... \right) spans into parengroup/leftparengroup
// scope-boundary tokens, so their interior is analysed independently.
// Recurses into {} group inners too.

function groupParens(tokens) {
  const result = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    // Recurse into {} groups.
    if (tok.type === 'group') {
      result.push({ type: 'group', inner: groupParens(tok.inner) });
      i++; continue;
    }

    // \left( ... \right)  or  \left[ ... \right]
    if (tok.type === 'cmd' && tok.text === '\\left') {
      const next = tokens[i + 1];
      if (next?.type === 'char' && (next.text === '(' || next.text === '[')) {
        const openDelim  = next.text;
        const closeDelim = openDelim === '(' ? ')' : ']';
        let depth = 1, j = i + 2;
        while (j < tokens.length && depth > 0) {
          if (tokens[j].type === 'cmd' && tokens[j].text === '\\left')  depth++;
          if (tokens[j].type === 'cmd' && tokens[j].text === '\\right') depth--;
          j++;
        }
        if (depth === 0) {
          // tokens[j-1] is \right; tokens[j] should be the closing delimiter char
          const inner = groupParens(tokens.slice(i + 2, j - 1));
          result.push({ type: 'leftparengroup', openDelim, closeDelim, inner });
          i = j + 1; // skip past \right + closing delimiter
          continue;
        }
      }
      result.push(tok); i++; continue;
    }

    // Plain ( ... )
    if (tok.type === 'char' && tok.text === '(') {
      let depth = 1, j = i + 1;
      while (j < tokens.length && depth > 0) {
        if (tokens[j].type === 'char' && tokens[j].text === '(') depth++;
        else if (tokens[j].type === 'char' && tokens[j].text === ')') depth--;
        j++;
      }
      if (depth === 0) {
        const inner = groupParens(tokens.slice(i + 1, j - 1));
        result.push({ type: 'parengroup', inner });
        i = j;
      } else {
        result.push(tok); i++;
      }
      continue;
    }

    result.push(tok); i++;
  }

  return result;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function opLevel(tok) { return PEMDAS_LEVEL[tok.text] ?? null; }

function isRel(tok) {
  return (tok.type === 'char' && REL_CHARS.has(tok.text)) ||
         (tok.type === 'cmd'  && REL_CMDS.has(tok.text));
}

function atom(tok) {
  if (tok.type === 'group' || tok.type === 'parengroup' || tok.type === 'leftparengroup') return '';
  return tok.text ?? '';
}

function emitRaw(tokens) {
  return tokens.map(tok => {
    if (tok.type === 'group')           return '{' + emitRaw(tok.inner) + '}';
    if (tok.type === 'parengroup')      return '(' + emitRaw(tok.inner) + ')';
    if (tok.type === 'leftparengroup')  return `\\left${tok.openDelim}` + emitRaw(tok.inner) + `\\right${tok.closeDelim}`;
    return atom(tok);
  }).join('');
}

function spaced(text, mu) {
  if (mu === 0) return `{${text}}`;
  return `\\mspace{${mu}mu}{${text}}\\mspace{${mu}mu}`;
}

// ─── pass 1: scan ─────────────────────────────────────────────────────────────
// Walk at the current scope level, collecting binary PEMDAS operator levels.
//
// Scope rules:
// • bare {} groups      → scan INTO (their operators belong to this scope)
// • parengroup ()       → treat as atom (scope boundary)
// • leftparengroup \left() → treat as atom (scope boundary)
// • ^{} _{} script args → separate scope, skip
// • \cmd{}{} arg groups → separate scope per CMD_ARITY, skip
//
// IMPORTANT: opLevel / isRel checks run BEFORE the generic cmd handler so that
// operator commands like \pm, \cdot, \times are recognised as operators, not
// silently consumed as zero-arity commands.

function scanLevels(tokens) {
  const found = new Set();
  let pt = 'start';
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'char' && tok.text === ' ') { i++; continue; }

    // Bare {} group — transparent; scan its operators as part of this scope.
    if (tok.type === 'group') {
      for (const lvl of scanLevels(tok.inner)) found.add(lvl);
      pt = 'operand'; i++; continue;
    }

    // Paren groups — opaque atoms.
    if (tok.type === 'parengroup' || tok.type === 'leftparengroup') {
      pt = 'operand'; i++; continue;
    }

    // Script arguments — separate scope.
    if (tok.type === 'sup' || tok.type === 'sub') {
      i++; if (i < tokens.length) i++;
      pt = 'operand'; continue;
    }

    // PEMDAS operator — must come before the generic cmd check.
    const lvl = opLevel(tok);
    if (lvl !== null) {
      if (pt === 'operand') found.add(lvl);
      pt = 'operator'; i++; continue;
    }

    // Relation — must come before the generic cmd check.
    if (isRel(tok)) {
      pt = 'operator'; i++; continue;
    }

    // Text-mode command — skip its group arg.
    if (TEXT_CMDS.has(tok.text)) {
      i++; if (tokens[i]?.type === 'group') i++;
      pt = 'operand'; continue;
    }

    // Command with owned argument groups.
    if (tok.type === 'cmd') {
      const arity = CMD_ARITY[tok.text] ?? 0;
      i++;
      for (let a = 0; a < arity; a++) {
        if (tokens[i]?.type === 'group') i++;
      }
      pt = 'operand'; continue;
    }

    // Remaining chars.
    if (tok.text === '|') {
      pt = pt === 'operand' ? 'operand' : 'open';
    } else if (tok.text === '(' || tok.text === '[') {
      pt = 'open';
    } else if (tok.text === ')' || tok.text === ']') {
      pt = 'operand';
    } else {
      pt = 'operand';
    }
    i++;
  }

  return found;
}

// ─── pass 2: emit ─────────────────────────────────────────────────────────────
// inParen: true when inside a ( ) or \left( ) group.
//   Selects MU_TABLE_PAREN so inner spacing is visibly smaller, signalling the
//   group is a single unit at the outer level.

function reconstruct(tokens, inParen = false) {
  const table  = inParen ? MU_TABLE_PAREN : MU_TABLE;
  const levels = scanLevels(tokens);
  const sorted = [...levels].sort((a, b) => a - b);
  const N      = sorted.length;
  const muMap  = Object.fromEntries(sorted.map((lvl, rank) => [lvl, tableMu(table, N, rank)]));

  let out = '';
  let pt  = 'start';
  let i   = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === 'char' && tok.text === ' ') { out += ' '; i++; continue; }

    // Bare {} group → new scope, inherit inParen level.
    if (tok.type === 'group') {
      out += '{' + reconstruct(tok.inner, inParen) + '}';
      pt = 'operand'; i++; continue;
    }

    // Paren group → new scope with reduced spacing.
    if (tok.type === 'parengroup') {
      out += '(' + reconstruct(tok.inner, true) + ')';
      pt = 'operand'; i++; continue;
    }

    // \left( ) group → same as parengroup but with \left/\right delimiters.
    if (tok.type === 'leftparengroup') {
      out += `\\left${tok.openDelim}` + reconstruct(tok.inner, true) + `\\right${tok.closeDelim}`;
      pt = 'operand'; i++; continue;
    }

    // Script → recurse arg as its own full-table scope (font already smaller).
    if (tok.type === 'sup' || tok.type === 'sub') {
      const marker = tok.type === 'sup' ? '^' : '_';
      const arg = tokens[i + 1];
      if (arg?.type === 'group') {
        out += marker + '{' + reconstruct(arg.inner) + '}';
        i += 2;
      } else if (arg) {
        out += marker + atom(arg);
        i += 2;
      } else {
        out += marker; i++;
      }
      pt = 'operand'; continue;
    }

    // Text-mode command.
    if (TEXT_CMDS.has(tok.text)) {
      out += tok.text;
      const next = tokens[i + 1];
      if (next?.type === 'group') { out += '{' + emitRaw(next.inner) + '}'; i += 2; }
      else i++;
      pt = 'operand'; continue;
    }

    // PEMDAS operator — must come before the generic cmd fallthrough.
    const lvl = opLevel(tok);
    if (lvl !== null) {
      const mu = muMap[lvl] ?? 5;
      out += pt === 'operand' ? spaced(tok.text, mu) : tok.text;
      pt = 'operator'; i++; continue;
    }

    // Relation.
    if (isRel(tok)) {
      out += spaced(tok.text, REL_MU);
      pt = 'operator'; i++; continue;
    }

    if (tok.type === 'char' && tok.text === '|') {
      out += '|'; pt = pt === 'operand' ? 'operand' : 'open'; i++; continue;
    }

    out += atom(tok);
    pt = 'operand'; i++;
  }

  return out;
}

export function pemdasSpacing(latex) {
  return reconstruct(groupParens(tokenize(latex)));
}
