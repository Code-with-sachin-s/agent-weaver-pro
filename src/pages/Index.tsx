import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentGraph, NodeId, NodeStatus } from "@/components/agent/AgentGraph";
import { TraceLog, TraceEntry } from "@/components/agent/TraceLog";
import { Sparkles, Play, Loader2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const EXAMPLES = [
  "What were the biggest AI announcements this week?",
  "Compute the 50th Fibonacci number and the sum of its digits.",
  "Who won the most recent Formula 1 Grand Prix?",
  "Generate the first 20 prime numbers and their sum.",
];

export default function Index() {
  const { toast } = useToast();
  const [query, setQuery] = useState(EXAMPLES[1]);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [finalAnswer, setFinalAnswer] = useState<string>("");

  const [statuses, setStatuses] = useState<Record<NodeId, NodeStatus>>({
    planner: "idle", search: "idle", code: "idle", executor: "idle", response: "idle",
  });
  const [activeEdges, setActiveEdges] = useState<Set<string>>(new Set());

  const reset = () => {
    setTrace([]);
    setFinalAnswer("");
    setStatuses({ planner: "idle", search: "idle", code: "idle", executor: "idle", response: "idle" });
    setActiveEdges(new Set());
  };

  const handleRun = async () => {
    if (!query.trim()) return;
    reset();
    setRunning(true);

    let prevNode: NodeId | null = null;

    try {
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON}`,
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const evt = JSON.parse(line.slice(6));

          if (evt.type === "node_start") {
            const n = evt.node as NodeId;
            setStatuses((s) => ({ ...s, [n]: "active" }));
            if (prevNode) {
              const key = `${prevNode}->${n}`;
              setActiveEdges((e) => new Set(e).add(key));
            }
            setTrace((t) => [...t, { node: n, phase: "start", ts: Date.now() }]);
          } else if (evt.type === "node_end") {
            const n = evt.node as NodeId;
            setStatuses((s) => ({ ...s, [n]: "done" }));
            setTrace((t) => [...t, { node: n, phase: "end", data: evt.data, ts: Date.now() }]);
            prevNode = n;

            // After planner, mark the unused branch as skipped
            if (n === "planner" && evt.data?.route) {
              const skipped: NodeId | null = evt.data.route === "search" ? "code" : "search";
              setStatuses((s) => ({
                ...s,
                ...(skipped ? { [skipped]: "skipped" as NodeStatus } : {}),
                ...(evt.data.route === "search" ? { executor: "skipped" as NodeStatus } : {}),
              }));
            }
          } else if (evt.type === "done") {
            setFinalAnswer(evt.state?.response ?? "");
          } else if (evt.type === "error") {
            throw new Error(evt.error);
          }
        }
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Agent error",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
    }
  };

  const downloadPython = () => {
    const a = document.createElement("a");
    a.href = "/agent_langgraph.py";
    a.download = "agent_langgraph.py";
    a.click();
  };

  const heroBadge = useMemo(
    () => (
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-mono text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" />
        LangGraph · Tavily · Sandboxed JS
      </span>
    ),
    []
  );

  return (
    <main className="min-h-screen px-4 py-10 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="space-y-4 text-center">
          {heroBadge}
          <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight">
            5-Node Agent
            <span className="block bg-gradient-to-r from-primary via-cyan-300 to-accent bg-clip-text text-transparent">
              Planner → Search / Code → Executor → Response
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            A LangGraph-style agent with conditional routing. The planner decides whether to
            <span className="text-foreground"> search the web with Tavily</span> or
            <span className="text-foreground"> write &amp; execute JS code</span>, then synthesizes a final answer.
          </p>
        </header>

        <section className="rounded-2xl border border-border bg-card/40 backdrop-blur-sm p-5 shadow-card-soft space-y-4">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything…"
            rows={3}
            className="resize-none font-mono bg-background/40"
            disabled={running}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleRun} disabled={running} variant="default" className="gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running graph…" : "Run agent"}
            </Button>
            <Button onClick={downloadPython} variant="secondary" className="gap-2">
              <Download className="h-4 w-4" />
              Python LangGraph script
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  disabled={running}
                  className="text-xs font-mono px-2.5 py-1 rounded-md border border-border bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-foreground transition"
                >
                  {ex.length > 38 ? ex.slice(0, 38) + "…" : ex}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold mb-3">Graph</h2>
          <AgentGraph statuses={statuses} activeEdges={activeEdges} />
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div>
            <h2 className="font-display text-xl font-semibold mb-3">Trace</h2>
            <TraceLog entries={trace} />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold mb-3">Final answer</h2>
            <div className="h-[420px] rounded-2xl border border-border bg-card/40 backdrop-blur-sm shadow-card-soft p-5 overflow-auto">
              {finalAnswer ? (
                <article className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap leading-relaxed">
                  {finalAnswer}
                </article>
              ) : (
                <p className="font-mono text-xs text-muted-foreground italic">
                  // run the agent to see the synthesized response
                </p>
              )}
            </div>
          </div>
        </section>

        <footer className="text-center text-xs text-muted-foreground font-mono pt-6">
          Built with Lovable AI Gateway · Tavily · Sandboxed JS executor
        </footer>
      </div>
    </main>
  );
}
