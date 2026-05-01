"""
5-Node LangGraph Agent
======================
Nodes: planner → (search | code) → executor → response
- Planner uses conditional routing to choose `search` or `code`
- Search node uses Tavily
- Code node generates a small Python snippet
- Executor runs it in a restricted namespace
- Response node synthesizes the final answer

Install:
    pip install langgraph langchain-openai tavily-python python-dotenv

Env vars:
    OPENAI_API_KEY   - required
    TAVILY_API_KEY   - required

Run:
    python agent_langgraph.py "your question here"
"""

from __future__ import annotations
import os
import sys
import json
from typing import TypedDict, Literal, Optional, List

from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from tavily import TavilyClient


# ---------- State ----------
class Plan(TypedDict):
    route: Literal["search", "code"]
    reasoning: str
    sub_task: str


class Execution(TypedDict):
    ok: bool
    output: str
    error: Optional[str]


class AgentState(TypedDict, total=False):
    query: str
    plan: Plan
    search_results: List[dict]
    code: str
    execution: Execution
    response: str


# ---------- LLM ----------
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)


# ---------- Nodes ----------
def planner_node(state: AgentState) -> AgentState:
    """Decides the next route."""
    sys_msg = SystemMessage(content=(
        "You are the planner for a 5-node agent. "
        "Decide if the query needs 'search' (current/factual info) or 'code' "
        "(math, computation, data transforms). "
        "Respond ONLY with compact JSON: "
        '{"route": "search"|"code", "reasoning": "...", "sub_task": "..."}'
    ))
    user = HumanMessage(content=f'Query: "{state["query"]}"')
    raw = llm.invoke([sys_msg, user]).content
    raw = raw.strip().strip("`")
    if raw.startswith("json"):
        raw = raw[4:].strip()
    plan = json.loads(raw)
    print(f"[planner] route={plan['route']} :: {plan['reasoning']}")
    return {"plan": plan}


def search_node(state: AgentState) -> AgentState:
    """Tavily web search."""
    tavily = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
    sub = state["plan"]["sub_task"]
    print(f"[search] tavily query: {sub}")
    res = tavily.search(query=sub, max_results=5, search_depth="basic")
    results = [
        {"title": r["title"], "url": r["url"], "content": r.get("content", "")}
        for r in res.get("results", [])
    ]
    print(f"[search] got {len(results)} results")
    return {"search_results": results}


def code_node(state: AgentState) -> AgentState:
    """Generate a small, self-contained Python snippet."""
    sys_msg = SystemMessage(content=(
        "Write a SHORT, self-contained Python snippet to solve the task. "
        "Constraints: standard library only (no imports needed beyond math). "
        "Use ONLY: math, basic data types, list/dict/str/int/float ops. "
        "Assign the final value to a variable named `result`. "
        "Output ONLY raw Python. No markdown, no explanations."
    ))
    user = HumanMessage(content=f"Task: {state['plan']['sub_task']}")
    code = llm.invoke([sys_msg, user]).content
    code = code.strip().strip("`")
    if code.startswith("python"):
        code = code[6:].strip()
    print(f"[code] generated {len(code)} chars")
    return {"code": code}


def executor_node(state: AgentState) -> AgentState:
    """Run the generated code in a restricted namespace."""
    import math
    code = state.get("code", "")
    banned = ("import os", "import sys", "open(", "__import__", "subprocess",
              "eval(", "exec(", "socket", "requests")
    if any(b in code for b in banned):
        return {"execution": {"ok": False, "output": "", "error": "Banned identifier"}}

    safe_globals = {"__builtins__": {
        "len": len, "range": range, "sum": sum, "min": min, "max": max,
        "abs": abs, "round": round, "int": int, "float": float, "str": str,
        "list": list, "dict": dict, "tuple": tuple, "set": set,
        "enumerate": enumerate, "zip": zip, "sorted": sorted, "reversed": reversed,
        "any": any, "all": all, "map": map, "filter": filter, "print": print,
    }, "math": math}
    local: dict = {}
    try:
        exec(code, safe_globals, local)  # noqa: S102 - sandboxed
        result = local.get("result", "")
        print(f"[executor] ok: {repr(result)[:120]}")
        return {"execution": {"ok": True, "output": str(result), "error": None}}
    except Exception as e:
        print(f"[executor] error: {e}")
        return {"execution": {"ok": False, "output": "", "error": str(e)}}


def response_node(state: AgentState) -> AgentState:
    """Synthesize the final answer."""
    if state.get("search_results"):
        ctx = "Search results:\n" + "\n\n".join(
            f"[{i+1}] {r['title']} ({r['url']})\n{r['content']}"
            for i, r in enumerate(state["search_results"])
        )
    else:
        ex = state.get("execution", {})
        ctx = (
            f"Generated code:\n{state.get('code','')}\n\n"
            f"Execution {'succeeded' if ex.get('ok') else 'failed'}:\n"
            f"{ex.get('output') if ex.get('ok') else ex.get('error')}"
        )
    sys_msg = SystemMessage(content=(
        "You are the final responder. Synthesize a concise, helpful answer "
        "for the user's original query using the provided context. "
        "Cite sources by [n] when search results are used."
    ))
    user = HumanMessage(content=f"Query: {state['query']}\n\n{ctx}")
    text = llm.invoke([sys_msg, user]).content
    print(f"[response] {len(text)} chars")
    return {"response": text}


# ---------- Conditional routing ----------
def route_from_planner(state: AgentState) -> Literal["search", "code"]:
    return state["plan"]["route"]


# ---------- Build the graph ----------
def build_graph():
    g = StateGraph(AgentState)
    g.add_node("planner", planner_node)
    g.add_node("search", search_node)
    g.add_node("code", code_node)
    g.add_node("executor", executor_node)
    g.add_node("response", response_node)

    g.set_entry_point("planner")

    # Conditional edges from planner
    g.add_conditional_edges(
        "planner",
        route_from_planner,
        {"search": "search", "code": "code"},
    )

    # Search → response (skip executor)
    g.add_edge("search", "response")

    # Code → executor → response
    g.add_edge("code", "executor")
    g.add_edge("executor", "response")

    g.add_edge("response", END)
    return g.compile()


# ---------- CLI ----------
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python agent_langgraph.py "your question"')
        sys.exit(1)
    query = " ".join(sys.argv[1:])
    graph = build_graph()
    final = graph.invoke({"query": query})
    print("\n===== FINAL ANSWER =====\n")
    print(final.get("response", ""))
