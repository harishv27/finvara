import type { z } from "zod";
import type { FinancialContext } from "../lib/snapshot.ts";

export type AgentId = "personal" | "investment" | "wealth";

export interface ToolContext {
  userId: number;
  /** Lazily computed snapshot of the user's finances (profile + this month's budget). */
  ctx: () => FinancialContext;
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  agent: AgentId;
  title: string;
  description: string;
  schema: S;
  /** Words/phrases that route a message to this tool in offline demo mode. */
  keywords: string[];
  run: (tc: ToolContext, input: z.infer<S>) => unknown;
  /** Markdown rendering of the result — used in demo mode and as a structured fallback. */
  render: (result: any, input: z.infer<S>) => string;
  /** Best-effort argument extraction from free text for demo mode. */
  demoArgs?: (message: string) => Record<string, unknown>;
}

/** Infers the input type from the zod schema, then erases it so tools can live in one array. */
export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool {
  return tool as unknown as AgentTool;
}
