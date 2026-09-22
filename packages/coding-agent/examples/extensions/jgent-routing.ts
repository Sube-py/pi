export interface JgentTool {
	id: string;
	description: string;
}

export interface JevNoulAnswer {
	type: "noul";
	noul: number;
}

export interface JevResponse {
	answers: Record<string, JevNoulAnswer>;
}

export interface JevRequest {
	state: string;
	model: string;
	questions: Record<string, { type: "noul"; instructions: string }>;
}

export const THRESHOLD = 0.5;

/**
 * One Jev call classifies every tool independently. The state carries the
 * model's own description of the task plus the registry listing; each noul
 * asks whether that one tool is required. Jev evaluates the questions in
 * parallel against the same state, so the count barely changes latency.
 */
export function buildJevRequest(description: string, tools: JgentTool[]): JevRequest {
	const listing = tools.map((tool) => `${tool.id}: ${tool.description}`).join("\n");
	const questions: JevRequest["questions"] = {};
	for (const tool of tools) {
		questions[tool.id] = {
			type: "noul",
			instructions: `Does accomplishing the task require the tool ${tool.id}?`,
		};
	}
	return {
		state: `Task:\n${description}\n\nTools:\n${listing}`,
		model: "jev-latest",
		questions,
	};
}

/** A tool is selected only when its probability strictly exceeds the threshold. */
export function selectTools(response: JevResponse, threshold: number): string[] {
	return Object.entries(response.answers)
		.filter(([, answer]) => answer.noul > threshold)
		.map(([id]) => id);
}
