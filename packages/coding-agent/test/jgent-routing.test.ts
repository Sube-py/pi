import { describe, expect, it } from "vitest";
import { buildJevRequest, selectTools, THRESHOLD } from "../examples/extensions/jgent-routing.ts";

const tools = [
	{ id: "read", description: "Read a file" },
	{ id: "grep", description: "Search file contents" },
];

describe("buildJevRequest", () => {
	it("asks one noul per tool and puts the description in the state", () => {
		const request = buildJevRequest("find where the port is set", tools);

		expect(request.model).toBe("jev-latest");
		expect(request.state).toContain("find where the port is set");
		expect(request.state).toContain("read: Read a file");
		expect(request.state).toContain("grep: Search file contents");
		expect(Object.keys(request.questions).sort()).toEqual(["grep", "read"]);
		for (const question of Object.values(request.questions)) {
			expect(question.type).toBe("noul");
			expect(question.instructions).toContain("require");
		}
	});
});

describe("selectTools", () => {
	it("keeps only tools whose probability is above the threshold", () => {
		const selected = selectTools(
			{
				answers: {
					read: { type: "noul", noul: 0.9 },
					grep: { type: "noul", noul: THRESHOLD },
					edit: { type: "noul", noul: 0.51 },
				},
			},
			THRESHOLD,
		);

		expect(selected.sort()).toEqual(["edit", "read"]);
	});

	it("returns an empty list when nothing clears the threshold", () => {
		const selected = selectTools({ answers: { read: { type: "noul", noul: 0.1 } } }, THRESHOLD);
		expect(selected).toEqual([]);
	});
});
