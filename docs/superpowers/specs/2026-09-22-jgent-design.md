# jgent: Jev-routed tool loading for pi

## Problem

A pi agent carries every tool schema in the model's context on every turn: the built-in tools, every tool an extension registers with `pi.registerTool()`, and the skill catalog. The tool descriptions outweigh the user's message even for a trivial turn like "你好", and they grow linearly as MCP servers, skills, and custom tools are added. The model pays for all of them on every call whether or not the turn needs any of them.

Tool selection is a classification decision, not a generation task. Jev (TypeSafe's System One model, `jev-latest`) is built for exactly that: it takes a state plus a set of typed questions and returns structured answers with probabilities, in one call, at roughly $0.042 per million input tokens with free output. It does not generate text and cannot call tools, so it cannot replace the model. It can replace the model's judgment about which tools a turn needs.

## Goal

Keep the model's resident tool list constant — `bash` plus one meta-tool — regardless of how many tools, skills, or MCP servers are configured. Let Jev choose the relevant tools per turn, expose them to the model as native function calls for exactly one turn, then drop them.

## Non-goals

- jgent does not execute tools. Selected tools run through pi's existing path: parameter validation, permissions, and rendering are unchanged.
- jgent does not add an MCP client. The registry interface is shaped so an MCP source can be added later without changing the routing flow.
- jgent does not change how skill content is read or how `bash` runs.
- No new tool-call protocol. The model calls loaded tools as native function calls.

## Decisions

| Question | Choice | Reason |
|---|---|---|
| What produces the intent Jev classifies | The model, via a `need` tool call | The user message is the wrong input. "我觉得你说的不对" tells Jev nothing about which tool is missing; the model doing the work knows. |
| How Jev selects | One `noul` per tool in a single Jev call | `choice` caps at 255 options and picks one. Independent `noul` questions support selecting many tools, have no practical cap, and add almost no latency because Jev evaluates every question in parallel. |
| How selected tools reach the model | They join the `tools` list of the next LLM request | Provider APIs reject a function call whose tool was not declared in that request, so the schema must be in the `tools` list for a native call to be legal. Doing it on the next request needs no change to pi's agent loop, and the gap is visible, so Jev's selection can be inspected. |
| When loaded tools are dropped | After the single turn they were loaded for | The cost of re-selecting is one cheap Jev call, not more model context. Retaining tools would let the context grow back toward the size this project exists to avoid. |
| Tool sources in v1 | pi built-ins except `bash`, extension tools, skills | No new tool format. An MCP source slots in later as another registry feeder. |

## Architecture

jgent is a pi extension. It owns two things: a tool registry, and the `need` tool.

### Registry

Built once at startup. Each entry is:

- `id` — the tool name the model will call
- `description` — one line, the only text Jev ever sees about this tool
- `schema` — the full parameter schema pi already has for the tool
- `execute` — pi's original execution function, stored untouched and never wrapped

Three feeders:

- Pi's built-in tools, excluding `bash`, which stays resident.
- Tools registered through `pi.registerTool()`. jgent intercepts registration so the tool lands in the registry instead of the resident tool list.
- Skills, registered from their name and description. The skill body stays where pi keeps it and is still read on demand; only the decision to surface the skill moves from the model to Jev.

### What the model sees each turn

Exactly two resident tools:

- `bash`, unchanged.
- `need`, with one string parameter: the model's own description of what it is trying to accomplish.

Plus whatever tools the previous turn's `need` loaded. Those are present for this turn only.

### One `need` call

1. The model calls `need` with its description of the task.
2. jgent sends Jev one request. The state is the model's description followed by the registry listing, each entry as its `id` and one-line description. The questions are one `noul` per registry entry: "Does accomplishing this require `<id>`?". Jev returns an independent probability per tool.
3. Every tool whose probability exceeds the threshold is selected.
4. `need` returns text naming the selected tools and restating what each does, so the selection is readable in the transcript.
5. jgent records the selected ids against the next turn.

### The following turn

When pi assembles the next LLM request, jgent adds the full schema of each recorded tool to the `tools` list. The model calls them as native function calls. Pi validates, permits, and runs them exactly as it would have without jgent.

At the end of that turn the recorded ids are cleared. The turn after is back to `bash` and `need`.

If the model needs nothing, it simply does not call `need`. Jev is never invoked and the turn costs nothing extra.

## Defaults

- Selection threshold: `0.5`.
- No cap on how many tools one `need` call may load. The threshold is the only control.
- Jev model: `jev-latest`, called at `POST https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY`.

## Failure behavior

- If the Jev call fails or times out, `need` returns the error and loads nothing. The model continues with `bash` alone and can retry `need` on its next turn. A routing failure never blocks the agent.
- If Jev selects nothing above the threshold, `need` returns that nothing matched. The model proceeds with `bash`.
- Jev's context budget is 64k tokens per request and 32k for the state plus the longest question. If the registry listing would exceed it, jgent splits the tools across consecutive Jev calls and unions the selections. Splitting does not change results, because each `noul` is evaluated independently.

## Testing

- Registry construction: built-ins except `bash`, an extension-registered tool, and a skill all appear as entries, and none of them appear in the resident tool list.
- `need` request shape: the Jev request contains exactly one `noul` per registry entry and the model's description as state. Tested against a fake Jev endpoint.
- Threshold: probabilities above `0.5` load, probabilities at or below do not.
- Turn scoping: a tool selected by `need` is present in the next turn's `tools` list and absent from the turn after that.
- Native execution: a loaded tool runs through pi's unchanged execution path.
- Failure: a Jev timeout produces a `need` result that names the error and adds no tools.

## Out of scope for v1

- An MCP registry feeder.
- Tuning the threshold per tool or per session.
- Caching Jev selections across identical `need` descriptions.
