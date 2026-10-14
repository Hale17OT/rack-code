import type { CredentialReference } from "../authentication/index.js";

export type RunId = string;
export type AttemptId = string;

export type PermissionMode = "read_only" | "ask" | "approve_for_me" | "full_access";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "interrupted" | "unknown";
export type AttemptStatus = "queued" | "running" | "completed" | "failed" | "interrupted" | "unknown";

export interface ApprovalRequest {
  readonly id: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly reason?: string;
}

export type ApprovalDecision = "allow" | "deny";

export interface RuntimeAccountContext {
  readonly accountId: string;
  readonly providerId: string;
  readonly credential: CredentialReference;
  readonly runtimeContextId: string;
}

export interface RuntimeContinuation {
  readonly nativeSessionId: string;
  readonly seenThroughMessageId?: string;
}

export interface RuntimeRunInput {
  readonly runId: RunId;
  readonly attemptId: AttemptId;
  readonly sessionId: string;
  readonly account: RuntimeAccountContext;
  readonly workspacePath: string;
  readonly prompt: string;
  readonly model?: string;
  readonly permissionMode: PermissionMode;
  readonly continuation?: RuntimeContinuation;
  readonly signal: AbortSignal;
  readonly requestApproval: (request: Omit<ApprovalRequest, "id">) => Promise<ApprovalDecision>;
}

export interface RuntimeCapabilities {
  readonly resume: boolean;
  readonly fork: boolean;
  readonly approvals: boolean;
  readonly quotaReporting: boolean;
  readonly browserTools: boolean;
  readonly computerUse: boolean;
}

/** A selectable model exposed by a runtime adapter. */
export interface RuntimeModel {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly description?: string;
  /** Provider-recommended default; the actual model ID is still sent on execution. */
  readonly isDefault?: boolean;
}

/** Discovery uses the same isolated account context as execution, without a model turn. */
export interface RuntimeModelInput {
  readonly account: RuntimeAccountContext;
  readonly workspacePath?: string;
}

export type RuntimeEvent =
  | { readonly type: "message_delta"; readonly text: string }
  | { readonly type: "thinking_delta"; readonly text: string }
  | { readonly type: "tool_request"; readonly tool: string; readonly input: unknown }
  | { readonly type: "tool_result"; readonly output: unknown }
  | { readonly type: "approval_request"; readonly request: ApprovalRequest }
  | { readonly type: "native_session"; readonly nativeSessionId: string }
  | { readonly type: "usage"; readonly inputTokens?: number; readonly outputTokens?: number; readonly costUsd?: number }
  | { readonly type: "availability"; readonly status: "available" | "unavailable" | "reauth_required"; readonly reason?: string; readonly quotaResetAt?: string }
  | { readonly type: "completed"; readonly result: string; readonly metadata?: Readonly<Record<string, unknown>> }
  | { readonly type: "failed"; readonly error: string; readonly retryable?: boolean }
  | { readonly type: "interrupted" };

export interface RuntimeAdapter {
  readonly runtimeId: string;
  /** Stable provider identity used for account selection and model routing. */
  readonly providerId?: string;
  /** Discovers selectable models for this account/workspace; rejects on provider failure. */
  readonly models?: (input: RuntimeModelInput) => Promise<readonly RuntimeModel[]>;
  capabilities(account: RuntimeAccountContext): Promise<RuntimeCapabilities>;
  startRun(input: RuntimeRunInput): AsyncIterable<RuntimeEvent>;
  resumeRun(input: RuntimeRunInput): AsyncIterable<RuntimeEvent>;
  cancel(input: Pick<RuntimeRunInput, "attemptId" | "signal">): Promise<void>;
  /**
   * Human-readable description of the native controls this adapter applies
   * for an application permission mode. The same app mode maps to different
   * provider settings, so clients display this text instead of inferring the
   * mapping from a provider or runtime name.
   */
  describePermissionMode(mode: PermissionMode): string;
}

export interface RunRecord {
  readonly id: RunId;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly prompt: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly model?: string;
  readonly permissionMode: PermissionMode;
  readonly status: RunStatus;
  readonly attemptIds: readonly AttemptId[];
  readonly result?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AttemptRecord {
  readonly id: AttemptId;
  readonly runId: RunId;
  readonly runtimeId: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly status: AttemptStatus;
  readonly nativeSessionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JournalEntry {
  readonly sequence: number;
  readonly runId: RunId;
  readonly attemptId: AttemptId;
  readonly type: RuntimeEvent["type"] | "run_started" | "attempt_started" | "run_status";
  readonly payload: unknown;
  readonly observedAt: string;
}
