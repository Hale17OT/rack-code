export type SessionId = string;

export type SessionMessageRole = "user" | "assistant" | "system" | "tool";

export interface SessionMessage {
  readonly id: string;
  readonly role: SessionMessageRole;
  readonly content: string;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface NativeContinuationReference {
  readonly runtimeId: string;
  readonly nativeSessionId: string;
  readonly seenThroughMessageId?: string;
}

export interface SessionRecord {
  readonly id: SessionId;
  readonly workspaceId: string;
  readonly title?: string;
  readonly messages: readonly SessionMessage[];
  readonly continuations: readonly NativeContinuationReference[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSessionInput {
  readonly id?: SessionId;
  readonly workspaceId: string;
  readonly title?: string;
}
