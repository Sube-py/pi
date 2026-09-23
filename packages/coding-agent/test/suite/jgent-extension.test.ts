import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { defaultJgentExtension, jgentExtension } from "../../examples/extensions/jgent.ts";
import type { JgentTool } from "../../examples/extensions/jgent-routing.ts";
import type { ExtensionAPI } from "../../src/index.ts";
import { createHarness } from "./harness.ts";

function toolNames(context: TranscriptContext): string[] {
	return getCurrentTools(context.messages)
		.map((tool) => tool.name)
		.sort();
}

describe("jgent extension", () => {
	it("keeps the built-in tools resident and gates only added tools", async () => {
		const router = async (): Promise<string[]> => [];
		const harness = await createHarness({ extensionFactories: [jgentExtension(router)] });
		try {
			const seen: string[][] = [];
			harness.setResponses([
				(context) => {
					seen.push(toolNames(context));
					return fauxAssistantMessage("nothing needed");
				},
			]);

			await harness.session.prompt("hello");

			expect(seen[0]).toEqual(expect.arrayContaining(["bash", "need", "read", "edit", "write"]));
		} finally {
			harness.cleanup();
		}
	});

	it("loads the tools Jev selects on the next request and drops them after the turn", async () => {
		const routed: { description: string; ids: string[] }[] = [];
		const router = async (description: string, tools: JgentTool[]): Promise<string[]> => {
			routed.push({ description, ids: tools.map((tool) => tool.id) });
			return ["read"];
		};
		const harness = await createHarness({ extensionFactories: [jgentExtension(router)] });
		try {
			const seen: string[][] = [];
			harness.setResponses([
				(context) => {
					seen.push(toolNames(context));
					return fauxAssistantMessage(fauxToolCall("need", { description: "read the config" }), {
						stopReason: "toolUse",
					});
				},
				(context) => {
					seen.push(toolNames(context));
					return fauxAssistantMessage("read it");
				},
			]);

			await harness.session.prompt("go");

			expect(routed).toEqual([{ description: "read the config", ids: [] }]);
			expect(seen[0]).toEqual(["bash", "edit", "find", "grep", "ls", "need", "powershell", "read", "write"]);
			expect(seen[1]).toEqual(["bash", "edit", "find", "grep", "ls", "need", "powershell", "read", "write"]);

			const seenAfter: string[][] = [];
			harness.setResponses([
				(context) => {
					seenAfter.push(toolNames(context));
					return fauxAssistantMessage("still nothing");
				},
			]);
			await harness.session.prompt("and now");

			expect(seenAfter).toEqual([["bash", "edit", "find", "grep", "ls", "need", "powershell", "read", "write"]]);
		} finally {
			harness.cleanup();
		}
	});

	it("loads nothing and keeps going when routing throws", async () => {
		const router = async (): Promise<string[]> => {
			throw new Error("Jev request timed out after 10000ms");
		};
		const harness = await createHarness({ extensionFactories: [jgentExtension(router)] });
		try {
			const seen: string[][] = [];
			harness.setResponses([
				(context) => {
					seen.push(toolNames(context));
					return fauxAssistantMessage(fauxToolCall("need", { description: "anything" }), {
						stopReason: "toolUse",
					});
				},
				(context) => {
					seen.push(toolNames(context));
					return fauxAssistantMessage("carried on");
				},
			]);

			await harness.session.prompt("go");

			expect(seen).toEqual([
				["bash", "edit", "find", "grep", "ls", "need", "powershell", "read", "write"],
				["bash", "edit", "find", "grep", "ls", "need", "powershell", "read", "write"],
			]);
			const result = harness.session.messages.find((message) => message.role === "toolResult");
			expect(JSON.stringify(result)).toContain("timed out");
		} finally {
			harness.cleanup();
		}
	});
});

it("routes a skill through Jev and delivers its content", async () => {
	const skills = [{ id: "pdf-tools", description: "Extract text from PDF files" }];
	let seenIds: string[] = [];
	const router = async (_description: string, tools: JgentTool[]): Promise<string[]> => {
		seenIds = tools.map((tool) => tool.id);
		return ["pdf-tools"];
	};
	const harness = await createHarness({ extensionFactories: [jgentExtension(router, skills)] });
	try {
		harness.setResponses([
			() => fauxAssistantMessage(fauxToolCall("need", { description: "read a pdf" }), { stopReason: "toolUse" }),
			() => fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		expect(seenIds).toContain("pdf-tools");
		const delivered = harness.session.messages.map((message) => JSON.stringify(message)).join("\n");
		expect(delivered).toContain("/skill:pdf-tools");
	} finally {
		harness.cleanup();
	}
});

it("builds the default router from TYPESAFE_API_KEY", async () => {
	process.env.TYPESAFE_API_KEY = "test-key";
	const harness = await createHarness({ extensionFactories: [defaultJgentExtension()] });
	try {
		const seen: string[][] = [];
		harness.setResponses([
			(context) => {
				seen.push(toolNames(context));
				return fauxAssistantMessage("no tools");
			},
		]);

		await harness.session.prompt("hi");

		expect(seen).toEqual([["bash", "edit", "find", "grep", "ls", "need", "powershell", "read", "write"]]);
	} finally {
		delete process.env.TYPESAFE_API_KEY;
		harness.cleanup();
	}
});

it("loads an external tool the router selects while the built-ins stay resident", async () => {
	const registerExternal = (pi: ExtensionAPI) => {
		pi.registerTool({
			name: "query_db",
			label: "Query DB",
			description: "Run a database query",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "rows" }], details: {} }),
		});
	};
	const router = async (_description: string, tools: JgentTool[]): Promise<string[]> => {
		expect(tools.map((tool) => tool.id)).toEqual(["query_db"]);
		return ["query_db"];
	};
	const harness = await createHarness({ extensionFactories: [registerExternal, jgentExtension(router)] });
	try {
		const seen: string[][] = [];
		harness.setResponses([
			(context) => {
				seen.push(toolNames(context));
				return fauxAssistantMessage(fauxToolCall("need", { description: "check the database" }), {
					stopReason: "toolUse",
				});
			},
			(context) => {
				seen.push(toolNames(context));
				return fauxAssistantMessage("checked");
			},
		]);

		await harness.session.prompt("go");

		expect(seen[0]).not.toContain("query_db");
		expect(seen[1]).toContain("query_db");
		expect(seen[1]).toEqual(expect.arrayContaining(["bash", "read", "edit", "write"]));
	} finally {
		harness.cleanup();
	}
});
