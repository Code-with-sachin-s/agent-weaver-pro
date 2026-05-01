import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type TraceEntry = {
  node: string;
  phase: "start" | "end";
  data?: any;
  ts: number;
};

const NODE_COLORS: Record<string, string> = {
  planner: "node-planner",
  search: "node-search",
  code: "node-code",
  executor: "node-executor",
  response: "node-response",
};

export function TraceLog({ entries }: { entries: TraceEntry[] }) {
  return (
    <ScrollArea className="h-[420px] w-full rounded-2xl border border-border bg-card/40 backdrop-blur-sm shadow-card-soft p-4">
      <div className="font-mono text-xs space-y-3">
        {entries.length === 0 && (
          <div className="text-muted-foreground italic">// trace will appear here…</div>
        )}
        {entries.map((e, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
              <span
                className={cn("px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider")}
                style={{
                  backgroundColor: `hsl(var(--${NODE_COLORS[e.node] ?? "primary"}) / 0.15)`,
                  color: `hsl(var(--${NODE_COLORS[e.node] ?? "primary"}))`,
                }}
              >
                {e.node}
              </span>
              <span className="text-muted-foreground">
                {e.phase === "start" ? "▶ entered" : "■ completed"}
              </span>
            </div>
            {e.phase === "end" && e.data !== undefined && (
              <pre className="text-foreground/80 bg-secondary/40 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words border border-border">
{typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
