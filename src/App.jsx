import { useState, useEffect, useLayoutEffect, useRef, Component } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { latexToSlt, splitFormulaAtTerms } from "./slt";
import SltTree from "./SltTree";
import SvgFormula from "./SvgFormula";
import "./App.css";

const NARRATED_EXAMPLE = {
  latex: String.raw`| E_i | = \binom{8}{i} . 5^i . 21^{8-i}`,
  narrations: [
    { term: String.raw`| E_i |`,       narration: "Number of 8-letter strings with i vowels", pos: "1" },
    { term: String.raw`\binom{8}{i}`,  narration: "Choose i locations for the vowels",         pos: "1" },
    { term: String.raw`5^i`,            narration: "Choose the vowels",                          pos: "1" },
    { term: String.raw`21^{8-i}`,       narration: "Choose the remaining letters",               pos: "1" },
  ],
};

const EXAMPLES = [
  { label: "binomial",   data: NARRATED_EXAMPLE },
  { label: "quadratic",  data: { latex: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}` } },
  { label: "chain rule", data: { latex: String.raw`\frac{d}{dx}[f(g(x))] = f'(g(x)) \cdot g'(x)` } },
  { label: "sum",        data: { latex: String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}` } },
  { label: "Bayes",      data: { latex: String.raw`P(A|B) = \frac{P(B|A) \cdot P(A)}{P(B)}` } },
  { label: "Gaussian",   data: { latex: String.raw`\int_{-\infty}^{\infty} e^{-x^2 / 2} \, dx = \sqrt{2\pi}` } },
];

function KaTeXRender({ latex }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(latex, ref.current, { displayMode: true, throwOnError: false });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [latex]);

  if (error) return <div className="katex-error">{error}</div>;
  return <div ref={ref} className="katex-output" />;
}

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e.message }; }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey)
      this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return <div className="parse-error">{this.state.error}</div>;
    return this.props.children;
  }
}

function InlineKaTeX({ latex }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current)
      katex.render(`\\displaystyle ${latex}`, ref.current, { displayMode: false, throwOnError: false });
  }, [latex]);
  return <span ref={ref} />;
}

function NarratedKaTeXRender({ data }) {
  const [measurements, setMeasurements] = useState(null);
  const [prevData, setPrevData] = useState(data);

  // Reset measurements when data changes (derived-state pattern)
  if (prevData !== data) {
    setPrevData(data);
    setMeasurements(null);
  }

  const measureRef = useRef(null);
  const rowRef = useRef(null);
  const svgRef = useRef(null);
  const termRefs = useRef([]);
  const labelRefs = useRef([]);

  const chunks = splitFormulaAtTerms(data);
  const hasTerms = chunks.some(c => c.type === 'term');

  // Pass 1: measure hidden elements after they render
  useLayoutEffect(() => {
    if (measurements !== null || !measureRef.current) return;
    const container = measureRef.current;
    setMeasurements({
      chunks: chunks.map((_, ci) => {
        const el = container.querySelector(`[data-ci="${ci}"]`);
        return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
      }),
      labels: (data.narrations ?? []).map((_, i) => {
        const el = container.querySelector(`[data-li="${i}"]`);
        return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
      }),
    });
  });

  // Pass 2: draw SVG lines after final layout renders
  useEffect(() => {
    if (!measurements || !svgRef.current || !rowRef.current) return;
    const svg = svgRef.current;
    const row = rowRef.current;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const rowRect = row.getBoundingClientRect();
    (data.narrations ?? []).forEach((_, i) => {
      const termEl = termRefs.current[i];
      const labelEl = labelRefs.current[i];
      if (!termEl || !labelEl) return;
      const termRect = termEl.getBoundingClientRect();
      const labelRect = labelEl.getBoundingClientRect();
      const x = (termRect.left + termRect.right) / 2 - rowRect.left;
      const y1 = labelRect.bottom - rowRect.top;
      const y2 = termRect.top - rowRect.top;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x); line.setAttribute('y1', y1);
      line.setAttribute('x2', x); line.setAttribute('y2', y2);
      line.setAttribute('stroke', '#888');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    });
  });

  // No terms found in formula — just show the formula normally
  if (!hasTerms) return <KaTeXRender latex={data.latex} />;

  // Measurement pass: hidden render to capture dimensions
  if (!measurements) {
    return (
      <div ref={measureRef} style={{ position: 'fixed', visibility: 'hidden', left: -9999, top: 0, display: 'flex' }}>
        {chunks.map((chunk, ci) => (
          <span key={ci} data-ci={ci} style={{ display: 'inline-block' }}>
            <InlineKaTeX latex={chunk.latex} />
          </span>
        ))}
        {(data.narrations ?? []).map((nr, i) => (
          <span key={`l${i}`} data-li={i} style={{ display: 'inline-block', maxWidth: '120px', fontSize: '0.72em', lineHeight: '1.3', whiteSpace: 'normal', textAlign: 'center' }}>
            {nr.narration}
          </span>
        ))}
      </div>
    );
  }

  // Slot width for each chunk: term slots grow to fit their label
  const slotWidths = chunks.map((chunk, ci) => {
    if (chunk.type === 'sep') return measurements.chunks[ci].w;
    return Math.max(measurements.chunks[ci].w, measurements.labels[chunk.index].w + 8);
  });

  return (
    <div ref={rowRef} style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
      />
      {/* Label row — same slot widths as formula row, sep slots are spacers */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        {chunks.map((chunk, ci) =>
          chunk.type === 'sep'
            ? <div key={ci} style={{ width: slotWidths[ci], flexShrink: 0 }} />
            : (
              <div
                key={ci}
                ref={el => { labelRefs.current[chunk.index] = el; }}
                style={{ width: slotWidths[ci], flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}
              >
                <div style={{ fontSize: '0.72em', maxWidth: '120px', textAlign: 'center', lineHeight: '1.3', whiteSpace: 'normal' }}>
                  {data.narrations[chunk.index].narration}
                </div>
              </div>
            )
        )}
      </div>
      {/* Formula row — inline-block for correct KaTeX baseline alignment */}
      <div style={{ display: 'block', textAlign: 'center', whiteSpace: 'nowrap' }}>
        {chunks.map((chunk, ci) =>
          chunk.type === 'sep'
            ? <span key={ci} style={{ display: 'inline-block', verticalAlign: 'baseline' }}><InlineKaTeX latex={chunk.latex} /></span>
            : (
              <span key={ci} style={{ display: 'inline-block', verticalAlign: 'baseline', minWidth: slotWidths[ci], textAlign: 'center', position: 'relative' }}>
                <div ref={el => { termRefs.current[chunk.index] = el; }}>
                  <InlineKaTeX latex={chunk.latex} />
                </div>
              </span>
            )
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [jsonText, setJsonText] = useState(JSON.stringify(NARRATED_EXAMPLE, null, 2));

  let data = null;
  let parseError = null;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    parseError = e.message;
  }

  const latex = data?.latex ?? '';
  let slt;
  if (latex) {
    try {
      slt = latexToSlt(latex);
    } catch (e) {
      console.error("Error generating SltTree:", e);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Live LaTeX Renderer</h1>
        <p className="subtitle">Math preview + Symbol Layout Tree</p>
      </header>

      <div className="examples">
        {EXAMPLES.map(ex => (
          <button
            key={ex.label}
            className="example-btn"
            onClick={() => setJsonText(JSON.stringify(ex.data, null, 2))}
          >
            {ex.label}
          </button>
        ))}
      </div>

      <div className="input-row">
        <textarea
          className="latex-input"
          value={jsonText}
          onChange={e => setJsonText(e.target.value)}
          spellCheck={false}
          placeholder='{"latex": "...", "narrations": [{"term": "...", "narration": "...", "pos": "1"}]}'
          rows={12}
        />
        {parseError && <div className="parse-error">{parseError}</div>}
      </div>

      <div className="panels">
        <section className="panel">
          <h2>Rendered Math</h2>
          <div className="katex-wrapper">
            <ErrorBoundary resetKey={jsonText}>
              <KaTeXRender latex={latex} />
            </ErrorBoundary>
          </div>
        </section>

        <section className="panel">
          <h2>Symbol Layout Tree</h2>
          <div className="slt-wrapper">
            <ErrorBoundary resetKey={jsonText}>
              {slt && <SltTree root={slt} />}
            </ErrorBoundary>
          </div>
        </section>
      </div>

      {latex && (
        <section className="panel" style={{ marginTop: '2rem' }}>
          <h2>SVG Formula</h2>
          <div className="katex-wrapper">
            <ErrorBoundary resetKey={jsonText}>
              <SvgFormula latex={latex} />
            </ErrorBoundary>
          </div>
        </section>
      )}

      {data && (
        <section className="panel" style={{ marginTop: '2rem' }}>
          <h2>Narrated Formula</h2>
          <div className="katex-wrapper">
            <ErrorBoundary resetKey={jsonText}>
              <NarratedKaTeXRender data={data} />
            </ErrorBoundary>
          </div>
        </section>
      )}
    </div>
  );
}
