import { cn } from "@/lib/utils";
import { Brain, Search, Code2, Cpu, MessageSquare } from "lucide-react";

export type NodeId = "planner" | "search" | "code" | "executor" | "response";
export type NodeStatus = "idle" | "active" | "done" | "skipped";

const NODES: { id: NodeId; label: string; icon: typeof Brain; color: string; x: number; y: number }[] = [
  { id: "planner",  label: "Planner",  icon: Brain,        color: "node-planner",  x: 80,  y: 180 },
  { id: "search",   label: "Search",   icon: Search,       color: "node-search",   x: 320, y: 80  },
  { id: "code",     label: "Code",     icon: Code2,        color: "node-code",     x: 320, y: 280 },
  { id: "executor", label: "Executor", icon: Cpu,          color: "node-executor", x: 560, y: 280 },
  { id: "response", label: "Response", icon: MessageSquare,color: "node-response", x: 800, y: 180 },
];

const EDGES: { from: NodeId; to: NodeId; label?: string }[] = [
  { from: "planner",  to: "search",   label: "route: search" },
  { from: "planner",  to: "code",     label: "route: code" },
  { from: "search",   to: "response" },
  { from: "code",     to: "executor" },
  { from: "executor", to: "response" },
];

function nodePos(id: NodeId) {
  return NODES.find((n) => n.id === id)!;
}

interface Props {
  statuses: Record<NodeId, NodeStatus>;
  activeEdges: Set<string>;
}

export function AgentGraph({ statuses, activeEdges }: Props) {
  return (
    <div className="relative w-full overflow-x-auto rounded-2xl border border-border bg-card/40 backdrop-blur-sm shadow-card-soft">
      <svg viewBox="0 0 900 380" className="w-full min-w-[820px] h-[380px]">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--primary))" />
          </marker>
        </defs>

        {EDGES.map((e) => {
          const a = nodePos(e.from);
          const b = nodePos(e.to);
          const key = `${e.from}->${e.to}`;
          const active = activeEdges.has(key);
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          return (
            <g key={key}>
              <line
                x1={a.x + 60} y1={a.y} x2={b.x - 60} y2={b.y}
                stroke={active ? "hsl(var(--primary))" : "hsl(var(--border))"}
                strokeWidth={active ? 2.5 : 1.5}
                strokeDasharray={active ? "8 6" : "0"}
                className={active ? "edge-active" : ""}
                markerEnd={active ? "url(#arrow-active)" : "url(#arrow)"}
              />
              {e.label && (
                <text x={midX} y={midY - 8} textAnchor="middle"
                  className="fill-muted-foreground font-mono"
                  style={{ fontSize: 10 }}>
                  {e.label}
                </text>
              )}
            </g>
          );
        })}

        {NODES.map((n) => {
          const status = statuses[n.id];
          const Icon = n.icon;
          const isActive = status === "active";
          const isDone = status === "done";
          const isSkipped = status === "skipped";
          return (
            <g key={n.id} transform={`translate(${n.x - 60}, ${n.y - 40})`}>
              <foreignObject width={120} height={80}>
                <div
                  className={cn(
                    "h-20 w-30 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all",
                    "bg-card/80 backdrop-blur-sm",
                    isActive && "node-active scale-105",
                    isDone && "border-primary",
                    isSkipped && "opacity-30",
                    !isActive && !isDone && !isSkipped && "border-border"
                  )}
                  style={{
                    borderColor: isActive
                      ? `hsl(var(--${n.color}))`
                      : isDone
                      ? `hsl(var(--${n.color}))`
                      : undefined,
                    boxShadow: isActive ? `0 0 24px hsl(var(--${n.color}) / 0.5)` : undefined,
                  }}
                >
                  <Icon className="h-5 w-5" style={{ color: `hsl(var(--${n.color}))` }} />
                  <div className="text-xs font-mono font-semibold text-foreground">{n.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    {status}
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
