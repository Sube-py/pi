import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { callJev, type JevClientOptions } from "./jgent-client.ts";
import { batchTools, buildJevRequest, type JgentTool, selectTools, THRESHOLD } from "./jgent-routing.ts";

export type JgentRouter = (description: string, tools: JgentTool[]) => Promise<string[]>;

const RESIDENT_TOOLS = ["bash", "need"];
const JEV_TOKEN_BUDGET = 64_000;

const NEED_PARAMETERS = Type.Object({
	description: Type.String({ description: "What you are trying to accomplish right now" }),
});

function registryTools(pi: ExtensionAPI): JgentTool[] {
	return pi
		.getAllTools()
		.filter((tool) => !RESIDENT_TOOLS.includes(tool.name))
		.map((tool) => ({ id: tool.name, description: tool.description }));
}

/**
 * Adapts the Jev client to the router interface. Batches the registry so each
 * call stays inside Jev's context budget and unions the selections. A failure
 * in any batch rejects, which the need tool turns into an error result.
 */
export function createJevRouter(options: JevClientOptions & { maxTokens: number }): JgentRouter {
	return async (description, tools) => {
		const selected = new Set<string>();
		for (const batch of batchTools(tools, options.maxTokens)) {
			const response = await callJev(buildJevRequest(description, batch), options);
			for (const id of selectTools(response, THRESHOLD)) selected.add(id);
		}
		return [...selected];
	};
}

export function jgentExtension(router: JgentRouter): ExtensionFactory {
	let toolsLoadedForTurn = false;

	return (pi: ExtensionAPI) => {
		pi.registerTool({
			name: "need",
			label: "Need",
			description:
				"Ask for the tools required to accomplish something. They become available on your next turn.",
			parameters: NEED_PARAMETERS,
			execute: async (_toolCallId, params) => {
				try {
					const selected = await router(params.description, registryTools(pi));
					toolsLoadedForTurn = true;
					pi.setActiveTools([...RESIDENT_TOOLS, ...selected]);
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

export function defaultJgentExtension(): ExtensionFactory {
	const apiKey = process.env.TYPESAFE_API_KEY ?? "";
	const router = createJevRouter({ apiKey, fetch, timeoutMs: 10_000, maxTokens: JEV_TOKEN_BUDGET });
	return jgentExtension(router);
}
