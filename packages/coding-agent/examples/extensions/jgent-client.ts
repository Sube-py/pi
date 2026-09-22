import type { JevRequest, JevResponse } from "./jgent-routing.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface JevClientOptions {
	apiKey: string;
	fetch: typeof fetch;
	timeoutMs: number;
}

export async function callJev(request: JevRequest, options: JevClientOptions): Promise<JevResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs);
	try {
		const response = await options.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				authorization: `Bearer ${options.apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(request),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Jev request failed with status ${response.status}`);
		}
		return (await response.json()) as JevResponse;
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw new Error(`Jev request timed out after ${options.timeoutMs}ms`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
