import type { Env, Params } from "./env";

/* One route = one old database function: same name, same parameters (p_token, p_...), same result. */
export type Route = (env: Env, p: Params, ctx: ExecutionContext) => Promise<unknown>;
export type Routes = Record<string, Route>;
