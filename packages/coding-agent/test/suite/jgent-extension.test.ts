import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createLayaRouter, defaultJgentExtension, jgentExtension } from "../../examples/extensions/jgent.ts";
import type { JgentTool } from "../../examples/extensions/jgent-routing.ts";
import { createHarness } from "./harness.ts";

function toolNames(context: TranscriptContext): string[] {
	return getCurrentTools(context.messages)
		.map((tool) => tool.name)
		.sort();
}

describe("jgent extension", () => {
	it("exposes only bash and need until a turn asks for tools", async () => {
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

			expect(seen).toEqual([["bash", "need"]]);
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

			expect(routed).toEqual([{ description: "read the config", ids: expect.arrayContaining(["read"]) }]);
			expect(seen[0]).toEqual(["bash", "need"]);
			expect(seen[1]).toEqual(["bash", "need", "read"]);

			const seenAfter: string[][] = [];
			harness.setResponses([
				(context) => {
					seenAfter.push(toolNames(context));
					return fauxAssistantMessage("still nothing");
				},
			]);
			await harness.session.prompt("and now");

			expect(seenAfter).toEqual([["bash", "need"]]);
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
				["bash", "need"],
				["bash", "need"],
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

		expect(seen).toEqual([["bash", "need"]]);
	} finally {
		delete process.env.TYPESAFE_API_KEY;
		harness.cleanup();
	}
});

it("uses the local Laya router when no TypeSafe key is set", async () => {
	delete process.env.TYPESAFE_API_KEY;
	let layaCalls = 0;
	const callLaya = async (request: { questions: Record<string, unknown> }) => {
		layaCalls += 1;
		const answers: Record<string, { type: "noul"; noul: number }> = {};
		for (const id of Object.keys(request.questions)) {
			answers[id] = { type: "noul", noul: id === "read" ? 0.9 : 0.1 };
		}
		return { answers };
	};
	const router = createLayaRouter(callLaya);
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

		expect(layaCalls).toBeGreaterThan(0);
		expect(seen[1]).toContain("read");
	} finally {
		harness.cleanup();
	}
});
