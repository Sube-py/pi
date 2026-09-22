import { describe, expect, it } from "vitest";
import { callJev } from "../examples/extensions/jgent-client.ts";
import type { JevRequest } from "../examples/extensions/jgent-routing.ts";

const request: JevRequest = {
	state: "Task:\nfind the port",
	model: "jev-latest",
	questions: { read: { type: "noul", instructions: "Does accomplishing the task require the tool read?" } },
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("callJev", () => {
	it("posts the request with a bearer token and returns the answers", async () => {
		let captured: { url?: string; auth?: string; body?: unknown } = {};
		const fetchMock: typeof fetch = async (url, init) => {
			captured = {
				url: String(url),
				auth: new Headers(init?.headers).get("authorization") ?? undefined,
				body: JSON.parse(String(init?.body)),
			};
			return jsonResponse({ answers: { read: { type: "noul", noul: 0.8 } } });
		};

		const response = await callJev(request, { apiKey: "secret", fetch: fetchMock, timeoutMs: 1000 });

		expect(captured.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(captured.auth).toBe("Bearer secret");
		expect(captured.body).toEqual(request);
		expect(response.answers.read?.noul).toBe(0.8);
	});

	it("throws with the status when Jev returns an error", async () => {
		const fetchMock: typeof fetch = async () => jsonResponse({ error: "nope" }, 500);
		await expect(callJev(request, { apiKey: "secret", fetch: fetchMock, timeoutMs: 1000 })).rejects.toThrow(/500/);
	});

	it("throws when the request times out", async () => {
		const fetchMock: typeof fetch = (_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			});
		await expect(callJev(request, { apiKey: "secret", fetch: fetchMock, timeoutMs: 10 })).rejects.toThrow(
			/timed out/,
		);
	});
});
