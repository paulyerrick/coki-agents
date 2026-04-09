import type { Tool } from '@coki/shared';

// ─── Re-export ────────────────────────────────────────────────────────────────

export type { Tool };

// ─── Tool Result ──────────────────────────────────────────────────────────────

/** Successful outcome from a tool execution. */
export interface ToolResult<T = unknown> {
  ok: true;
  data: T;
}

/** Error outcome from a tool execution. */
export interface ToolError {
  ok: false;
  error: string;
  /** Machine-readable error code for the agent to act on. */
  code?: string;
}

/** Union of success and error — all tool functions return this. */
export type ToolOutcome<T = unknown> = ToolResult<T> | ToolError;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wraps a value in a successful ToolResult. */
export function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

/** Wraps an error message in a ToolError. */
export function err(error: string, code?: string): ToolError {
  return { ok: false, error, code };
}
