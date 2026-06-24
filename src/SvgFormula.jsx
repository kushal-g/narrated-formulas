import { useState, useEffect } from 'react';
import { pemdasSpacing } from './spacingTransform.js';

// Lazily inject the MathJax browser bundle (from public/) the first time
// this component mounts. All subsequent callers share the same promise.
let mathJaxReady = null;

function loadMathJax() {
  if (mathJaxReady) return mathJaxReady;
  mathJaxReady = new Promise((resolve, reject) => {
    if (window.MathJax?.startup?.promise) {
      window.MathJax.startup.promise.then(() => resolve(window.MathJax));
      return;
    }
    window.MathJax = {
      tex: {},
      svg: { fontCache: 'global' },
      startup: {
        ready() {
          window.MathJax.startup.defaultReady();
          window.MathJax.startup.promise.then(() => resolve(window.MathJax));
        }
      }
    };
    const s = document.createElement('script');
    s.src = '/mathjax-tex-svg.js';
    s.async = true;
    s.onerror = () => reject(new Error('Failed to load MathJax'));
    document.head.appendChild(s);
  });
  return mathJaxReady;
}

export default function SvgFormula({ latex }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!latex) return;
    setError(null);
    let cancelled = false;
    loadMathJax()
      .then(MathJax => MathJax.tex2svgPromise(pemdasSpacing(latex), { display: true }))
      .then(node => { if (!cancelled) setHtml(node.outerHTML); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [latex]);

  if (error) return <div className="katex-error">{error}</div>;
  if (!html) return <div style={{ color: '#475569', padding: '12px', fontSize: '0.85rem' }}>Rendering…</div>;
  return <div style={{ color: '#f1f5f9' }} dangerouslySetInnerHTML={{ __html: html }} />;
}
