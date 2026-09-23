export interface JgentTool {
	id: string;
	description: string;
}

export interface JevChoiceAnswer {
	type: "choice";
	choice: string;
	probabilities: Record<string, number>;
}

export interface JevResponse {
	answers: Record<string, JevChoiceAnswer>;
}

export interface ChoiceQuestion {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
}

export interface JevRequest {
	state: string;
	model: string;
	questions: Record<string, ChoiceQuestion>;
}

export const THRESHOLD = 0.5;

/**
 * How many tools go in one choice question. Laya recommends staying near 20
 * options per choice, and the question head caps the option text at 192 tokens.
 */
export const CHOICE_GROUP_SIZE = 20;

const NONE = "none";

/**
 * The state carries only the task, so it stays far inside the 512-token
 * truncation. The tools live in the choice options, grouped so each question
 * stays small, and every group is asked in the same call.
 */
export function buildJevRequest(description: string, tools: JgentTool[]): JevRequest {
	const questions: JevRequest["questions"] = {};
	for (let start = 0; start < tools.length; start += CHOICE_GROUP_SIZE) {
		const group = tools.slice(start, start + CHOICE_GROUP_SIZE);
		const criteria: Record<string, string> = { [NONE]: "None of these tools is needed" };
		for (const tool of group) criteria[tool.id] = tool.description;
		questions[`group${start / CHOICE_GROUP_SIZE}`] = {
			type: "choice",
			instructions: "Which of these tools does the task require? Choose none if not one of them.",
			criteria,
		};
	}
	return { state: description, model: "jev-latest", questions };
}

/**
 * A tool is selected when its share of its group's probability is above the
 * threshold. `none` is never a tool, so a group where nothing fits selects
 * nothing.
 */
export function selectTools(response: JevResponse, threshold: number): string[] {
	const selected: string[] = [];
	for (const answer of Object.values(response.answers)) {
		for (const [id, probability] of Object.entries(answer.probabilities)) {
			if (id !== NONE && probability > threshold) selected.push(id);
		}
	}
	return selected;
}
