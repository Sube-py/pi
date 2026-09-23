import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { callJev, type JevClientOptions } from "./jgent-client.ts";
import { callLaya } from "./jgent-laya.ts";
import { buildJevRequest, type JgentTool, selectTools, THRESHOLD } from "./jgent-routing.ts";

export type JgentRouter = (description: string, tools: JgentTool[]) => Promise<string[]>;

// Pi's own tools stay with the model. jgent only gates the tools and skills
// added on top of them, which are what grow the context without bound.
const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"];
const RESIDENT_TOOLS = ["need", ...BUILTIN_TOOLS];
const NEED_PARAMETERS = Type.Object({
	description: Type.String({ description: "What you are trying to accomplish right now" }),
});

function isBuiltin(name: string): boolean {
	return BUILTIN_TOOLS.includes(name);
}

/** Tools jgent routes: everything registered beyond pi's built-in set. */
function registryTools(pi: ExtensionAPI): JgentTool[] {
	return pi
		.getAllTools()
		.filter((tool) => !isBuiltin(tool.name) && tool.name !== "need")
		.map((tool) => ({ id: tool.name, description: tool.description }));
}

/**
 * Adapts the Jev client to the router interface. Batches the registry so each
 * call stays inside Jev's context budget and unions the selections. A failure
 * in any batch rejects, which the need tool turns into an error result.
 */
export function createJevRouter(options: JevClientOptions): JgentRouter {
	return async (description, tools) => {
		const response = await callJev(buildJevRequest(description, tools), options);
		return selectTools(response, THRESHOLD);
	};
}

export function jgentExtension(router: JgentRouter, skills: JgentTool[] = []): ExtensionFactory {
	let toolsLoadedForTurn = false;

	return (pi: ExtensionAPI) => {
		pi.registerTool({
			name: "need",
			label: "Need",
			description: "Ask for the tools required to accomplish something. They become available on your next turn.",
			parameters: NEED_PARAMETERS,
			execute: async (_toolCallId, params) => {
				try {
					const catalog = [...registryTools(pi), ...skills];
					const selected = await router(params.description, catalog);
					const selectedSkills = selected.filter((id) => skills.some((skill) => skill.id === id));
					const selectedToolIds = selected.filter((id) => !selectedSkills.includes(id));
					toolsLoadedForTurn = true;
					pi.setActiveTools([...RESIDENT_TOOLS, ...selectedToolIds]);
					for (const skillName of selectedSkills) {
						pi.sendUserMessage(`/skill:${skillName}`, { deliverAs: "followUp", expandPromptTemplates: true });
					}
					const listed = selected.length > 0 ? selected.join(", ") : "nothing";
					return { content: [{ type: "text", text: `Loaded: ${listed}` }], details: { selected } };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: `Tool routing failed: ${message}` }],
						details: {},
						isError: true,
					};
				}
			},
		});

		pi.on("session_start", () => {
			pi.setActiveTools(RESIDENT_TOOLS);
		});

		// session_start can fire before the session finishes its own tool setup and
		// restores the full set, so narrow again right before the first request of a
		// turn unless need already chose tools for it.
		pi.on("before_agent_start", () => {
			if (!toolsLoadedForTurn) {
				pi.setActiveTools(RESIDENT_TOOLS);
			}
			toolsLoadedForTurn = false;
		});

		// Loaded tools last one turn. The next run starts from the resident set again.
		pi.on("agent_end", () => {
			pi.setActiveTools(RESIDENT_TOOLS);
		});
	};
}

export function defaultJgentExtension(skills: JgentTool[] = []): ExtensionFactory {
	const apiKey = process.env.TYPESAFE_API_KEY;
	const router = apiKey ? createJevRouter({ apiKey, fetch, timeoutMs: 10_000 }) : createLayaRouter();
	return jgentExtension(router, skills);
}

/**
 * Routes through a local Laya model instead of the Jev API. The model is
 * loaded once, on the first `need` call, and reused for the session.
 */
export function createLayaRouter(decide: typeof callLaya = callLaya): JgentRouter {
	return async (description, tools) => {
		const response = await decide(buildJevRequest(description, tools));
		return selectTools(response, THRESHOLD);
	};
}

export default function jgent(pi: ExtensionAPI): void {
	defaultJgentExtension()(pi);
}
