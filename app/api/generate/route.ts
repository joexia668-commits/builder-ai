import { createHandler, defaultDeps } from "./handler";

export const runtime = "edge";
export const maxDuration = 300;

export const POST = createHandler(defaultDeps);
