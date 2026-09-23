import { describe, expect, it } from "vitest";
import { buildJevRequest, CHOICE_GROUP_SIZE, selectTools, THRESHOLD } from "../examples/extensions/jgent-routing.ts";

const tools = [
	{ id: "read", description: "Read a file" },
	{ id: "grep", description: "Search file contents" },
];

describe("buildJevRequest", () => {
	it("puts only the task in the state and the tools in one choice", () => {
		const request = buildJevRequest("find where the port is set", tools);

		expect(request.model).toBe("jev-latest");
		expect(request.state).toBe("find where the port is set");
		expect(Object.keys(request.questions)).toEqual(["group0"]);
		const question = request.questions.group0;
		expect(question?.type).toBe("choice");
		expect(question?.criteria.read).toBe("Read a file");
		expect(question?.criteria.grep).toBe("Search file contents");
		expect(question?.criteria.none).toBeDefined();
	});

	it("splits a long registry into groups of a fixed size", () => {
		const many = Array.from({ length: CHOICE_GROUP_SIZE + 5 }, (_, index) => ({
			id: `tool${index}`,
			description: "does a thing",
		}));
		const request = buildJevRequest("task", many);

		expect(Object.keys(request.questions)).toEqual(["group0", "group1"]);
		expect(Object.keys(request.questions.group0?.criteria ?? {})).toHaveLength(CHOICE_GROUP_SIZE + 1);
		expect(Object.keys(request.questions.group1?.criteria ?? {})).toHaveLength(6);
	});
});

describe("selectTools", () => {
	it("keeps the tools whose probability clears the threshold in every group", () => {
		const selected = selectTools(
			{
				answers: {
					group0: { type: "choice", choice: "read", probabilities: { read: 0.9, grep: THRESHOLD, none: 0.1 } },
					group1: { type: "choice", choice: "edit", probabilities: { edit: 0.51, write: 0.2, none: 0.29 } },
				},
			},
			THRESHOLD,
		);

		expect(selected.sort()).toEqual(["edit", "read"]);
	});

	it("selects nothing when none takes the probability", () => {
		const selected = selectTools(
			{ answers: { group0: { type: "choice", choice: "none", probabilities: { read: 0.1, none: 0.9 } } } },
			THRESHOLD,
		);
		expect(selected).toEqual([]);
	});
});
