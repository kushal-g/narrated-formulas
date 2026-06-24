import { useMemo } from "react";

const EDGE_COLORS = {
  Right:  "#94a3b8",
  Punc:   "#6b7280",
  Sup:    "#f59e0b",
  Sub:    "#3b82f6",
  Above:  "#10b981",
  Below:  "#ef4444",
  Inside: "#8b5cf6",
};

// Spatial step sizes (pixels)
const STEP_X  = 65;   // horizontal advance for Right / Punc / Inside
const STEP_Y  = 75;   // vertical step for Above / Below (fraction)
const SUP_DX  = 22;   // Sup: slight right + up
const SUP_DY  = 48;
const SUB_DX  = 22;   // Sub: slight right + down
const SUB_DY  = 48;
const NODE_R  = 18;
const INSIDE_Y = 45;  // Inside chain rises above baseline
const PUNC_Y   = 15;  // Punc chain drops below baseline
const PAD     = 44;

// Place nodes at 2-D positions that mirror the mathematical layout:
//   Right / Punc / Inside → child is to the right
//   Sup  → child is up-right
//   Sub  → child is down-right
//   Above → child is directly above   (fraction numerator)
//   Below → child is directly below   (fraction denominator)
//
// Returns the x coordinate where the next Right-sibling should start.
function spatialLayout(node, x, y, positions, visited = new Set()) {
  if (!node || visited.has(node.id)) return x + STEP_X;
  visited.add(node.id);

  positions.set(node.id, { x, y, label: node.label });

  let nextX = x + STEP_X; // where the next Right child begins

  for (const [rel, child] of node.edges) {
    switch (rel) {
      case "Right":
        nextX = spatialLayout(child, nextX, y, positions, visited);
        break;
      case "Punc":
        nextX = spatialLayout(child, nextX, y + PUNC_Y, positions, visited);
        break;
      case "Inside":
        // radicand rises above the baseline so it never collides with Right
        spatialLayout(child, x + STEP_X, y - INSIDE_Y, positions, visited);
        break;
      case "Sup":
        spatialLayout(child, x + SUP_DX, y - SUP_DY, positions, visited);
        break;
      case "Sub":
        spatialLayout(child, x + SUB_DX, y + SUB_DY, positions, visited);
        break;
      case "Above":
        spatialLayout(child, x, y - STEP_Y, positions, visited);
        break;
      case "Below":
        spatialLayout(child, x, y + STEP_Y, positions, visited);
        break;
      default:
        break;
    }
  }

  return nextX;
}

function collectEdges(node, edges = [], visited = new Set()) {
  if (!node || visited.has(node.id)) return edges;
  visited.add(node.id);
  for (const [rel, child] of node.edges) {
    edges.push({ from: node.id, to: child.id, rel });
    collectEdges(child, edges, visited);
  }
  return edges;
}

export default function SltTree({ root }) {
  const { positions, edges } = useMemo(() => {
    if (!root) return { positions: new Map(), edges: [] };
    const positions = new Map();
    spatialLayout(root, 0, 0, positions);
    const edges = collectEdges(root);
    return { positions, edges };
  }, [root]);

  if (!root) return <div className="slt-empty">No SLT — enter LaTeX above</div>;

  const pts = [...positions.values()];
  const minX = Math.min(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxX = Math.max(...pts.map(p => p.x));
  const maxY = Math.max(...pts.map(p => p.y));

  const svgW = (maxX - minX) + NODE_R * 2 + PAD * 2;
  const svgH = (maxY - minY) + NODE_R * 2 + PAD * 2;

  const cx = p => p.x - minX + PAD + NODE_R;
  const cy = p => p.y - minY + PAD + NODE_R;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW}
        height={svgH}
        style={{ display: "block", margin: "0 auto" }}
      >
        <defs>
          {Object.entries(EDGE_COLORS).map(([rel, color]) => (
            <marker
              key={rel}
              id={`arr-${rel}`}
              viewBox="0 0 8 8"
              refX="6" refY="4"
              markerWidth="5" markerHeight="5"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill={color} />
            </marker>
          ))}
        </defs>

        {edges.map(({ from, to, rel }, i) => {
          const fp = positions.get(from);
          const tp = positions.get(to);
          if (!fp || !tp) return null;
          const color = EDGE_COLORS[rel] ?? "#888";
          const x1 = cx(fp), y1 = cy(fp);
          const x2 = cx(tp), y2 = cy(tp);
          const dx = x2 - x1, dy = y2 - y1;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / dist, uy = dy / dist;

          // Trim start/end to sit on circle perimeter
          const sx = x1 + ux * (NODE_R + 1), sy = y1 + uy * (NODE_R + 1);
          const ex = x2 - ux * (NODE_R + 6), ey = y2 - uy * (NODE_R + 6);
          const midX = (sx + ex) / 2, midY = (sy + ey) / 2;

          // The three rightward relations each get a distinct bow so they
          // don't overlap when drawn from nearby nodes:
          //   Right  → straight (bow = 0)
          //   Inside → bows upward  (bow = -20)
          //   Punc   → bows downward (bow = +20)
          const BOW = { Right: 0, Inside: -10, Punc: 20 };
          const bow = BOW[rel] ?? 0;

          // Control point for quadratic bezier (perpendicular to the edge)
          // perp unit vector: (-uy, ux)
          const cpX = midX + (-uy) * bow;
          const cpY = midY + ux * bow;

          // Point on bezier at t=0.5 for label placement
          const lx = 0.25 * sx + 0.5 * cpX + 0.25 * ex;
          const ly = 0.25 * sy + 0.5 * cpY + 0.25 * ey;

          // Nudge label perpendicular to the edge (or perpendicular to bow)
          const labelNudge = bow !== 0 ? 10 : 8;
          const nudgeSign = bow !== 0 ? Math.sign(bow) : 1;
          const lnx = lx + (-uy) * nudgeSign * labelNudge;
          const lny = ly + ux * nudgeSign * labelNudge;

          const d = bow === 0
            ? `M ${sx},${sy} L ${ex},${ey}`
            : `M ${sx},${sy} Q ${cpX},${cpY} ${ex},${ey}`;

          return (
            <g key={i}>
              <path
                d={d}
                stroke={color} strokeWidth={1.5} fill="none" opacity={0.8}
                markerEnd={`url(#arr-${rel})`}
              />
              <text
                x={lnx} y={lny}
                fontSize={8}
                fill={color}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="monospace"
              >
                {rel}
              </text>
            </g>
          );
        })}

        {[...positions.entries()].map(([id, p]) => (
          <g key={id} transform={`translate(${cx(p)},${cy(p)})`}>
            <circle r={NODE_R} fill="#1e293b" stroke="#475569" strokeWidth={1.5} />
            <text
              fontSize={13}
              fill="#f1f5f9"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="serif"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>

      {/* legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", padding: "10px 16px", borderTop: "1px solid #1e293b" }}>
        {Object.entries(EDGE_COLORS).map(([rel, color]) => (
          <span key={rel} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
            <span style={{ width: 22, height: 2, background: color, display: "inline-block", borderRadius: 1 }} />
            {rel}
          </span>
        ))}
      </div>
    </div>
  );
}
