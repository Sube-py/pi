import { Laya } from "@receptron/laya";
import type { JevRequest, JevResponse } from "./jgent-routing.ts";

/**
 * Runs one decision against a local Laya model. Laya speaks the same
 * request and response shape as the Jev API, so the result drops straight
 * into selectTools.
 */
export async function callLaya(request: JevRequest): Promise<JevResponse> {
	const laya = await callLaya.load();
	const result = await laya.systemOne(request.state, request.questions);
	return { answers: result.answers };
}

let loaded: Promise<Laya> | undefined;

callLaya.load = (): Promise<Laya> => {
	loaded ??= Laya.load();
	return loaded;
};
