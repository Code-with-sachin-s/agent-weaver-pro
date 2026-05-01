// 5-node agent graph: planner -> (search | code) -> executor -> response
// Conditional routing handled by the planner node.
// Streams Server-Sent Events with per-node trace updates.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");
const MODEL = "google/gemini-3-flash-preview";

type AgentState = {
  query: string;
  plan?: {
    route: "search" | "code";
    reasoning: string;
    sub_task: string;
  };
  search_results?: Array<{ title: string; url: string; content: string }>;
  code?: string;
  execution?: { ok: boolean; output: string; error?: string };
  response?: string;
};

// ---------- LLM helpers ----------
async function llmJSON(system: string, user: string, schema: any) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "respond",
            description: "Return a structured response",
            parameters: schema,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "respond" } },
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return JSON.parse(args);
}

async function llmText(system: string, user: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ---------- Node implementations ----------
async function plannerNode(state: AgentState) {
  const plan = await llmJSON(
    "You are a planner for a 5-node agent. Decide the next route based on the user's query. Use 'search' for factual/current info questions, 'code' for computations, math, data transforms, or algorithm tasks.",
    `User query: "${state.query}"\n\nReturn the route and a short sub-task description.`,
    {
      type: "object",
      properties: {
        route: { type: "string", enum: ["search", "code"] },
        reasoning: { type: "string" },
        sub_task: { type: "string" },
      },
      required: ["route", "reasoning", "sub_task"],
    },
  );
  return { ...state, plan };
}

async function searchNode(state: AgentState) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query: state.plan?.sub_task ?? state.query,
      max_results: 5,
      search_depth: "basic",
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const search_results = (data.results ?? []).map((r: any) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
  return { ...state, search_results };
}

async function codeNode(state: AgentState) {
  const code = await llmText(
    "You write small, self-contained JavaScript snippets to solve a task. Constraints:\n- Use ONLY: Math, Number, String, Array, Object, JSON, Date, parseInt, parseFloat, isNaN, isFinite.\n- No fetch, no require, no import, no setTimeout, no process, no Deno.\n- The snippet MUST end with an expression assigned to a variable named `result`.\n- Output ONLY raw JavaScript, no markdown, no comments, no explanations.",
    `Task: ${state.plan?.sub_task ?? state.query}\n\nWrite the JS snippet now.`,
  );
  // strip code fences if any
  const cleaned = code.replace(/^```(?:js|javascript)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return { ...state, code: cleaned };
}

function executorNode(state: AgentState): AgentState {
  const code = state.code ?? "";
  // Safe-subset check: reject dangerous identifiers
  const banned = /\b(fetch|require|import|process|Deno|globalThis|window|eval|Function|setTimeout|setInterval|XMLHttpRequest|WebSocket|localStorage)\b/;
  if (banned.test(code)) {
    return {
      ...state,
      execution: { ok: false, output: "", error: "Banned identifier in generated code" },
    };
  }
  try {
    // Build a sandboxed function with only allowed globals available.
    const sandbox = {
      Math, Number, String, Array, Object, JSON, Date,
      parseInt, parseFloat, isNaN, isFinite,
    };
    const fn = new Function(
      ...Object.keys(sandbox),
      `"use strict"; let result; ${code}; return result;`,
    );
    const out = fn(...Object.values(sandbox));
    return {
      ...state,
      execution: { ok: true, output: typeof out === "string" ? out : JSON.stringify(out) },
    };
  } catch (e) {
    return {
      ...state,
      execution: { ok: false, output: "", error: e instanceof Error ? e.message : String(e) },
    };
  }
}

async function responseNode(state: AgentState) {
  let context = "";
  if (state.search_results?.length) {
    context = "Search results:\n" + state.search_results
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.content}`)
      .join("\n\n");
  } else if (state.execution) {
    context = `Generated code:\n${state.code}\n\nExecution ${state.execution.ok ? "succeeded" : "failed"}:\n${state.execution.ok ? state.execution.output : state.execution.error}`;
  }
  const response = await llmText(
    "You are the final responder. Synthesize a concise, helpful answer for the user's original query using the provided context. Cite sources by [n] when search results are used.",
    `Original query: ${state.query}\n\n${context}`,
  );
  return { ...state, response };
}

// ---------- Graph runner with conditional routing ----------
async function runGraph(query: string, emit: (event: any) => Promise<void>) {
  let state: AgentState = { query };

  await emit({ type: "node_start", node: "planner" });
  state = await plannerNode(state);
  await emit({ type: "node_end", node: "planner", data: state.plan });

  // Conditional routing
  if (state.plan?.route === "search") {
    await emit({ type: "node_start", node: "search" });
    state = await searchNode(state);
    await emit({ type: "node_end", node: "search", data: state.search_results });
  } else {
    await emit({ type: "node_start", node: "code" });
    state = await codeNode(state);
    await emit({ type: "node_end", node: "code", data: { code: state.code } });

    await emit({ type: "node_start", node: "executor" });
    state = executorNode(state);
    await emit({ type: "node_end", node: "executor", data: state.execution });
  }

  await emit({ type: "node_start", node: "response" });
  state = await responseNode(state);
  await emit({ type: "node_end", node: "response", data: { response: state.response } });

  await emit({ type: "done", state });
}

// ---------- HTTP entrypoint (SSE) ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
    if (!TAVILY_API_KEY) throw new Error("TAVILY_API_KEY missing");

    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = async (event: any) => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          await runGraph(query, emit);
        } catch (e) {
          await emit({ type: "error", error: e instanceof Error ? e.message : String(e) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
