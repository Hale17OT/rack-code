import { randomUUID } from "node:crypto";

import { InvalidSessionError, SessionNotFoundError } from "./errors.js";
import type { SessionStore } from "./ports.js";
import type {
  CreateSessionInput,
  SessionImportSnapshot,
  NativeContinuationReference,
  SessionId,
  SessionMessage,
  SessionRecord,
} from "./types.js";

export interface SessionsServiceOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** Owns application sessions and keeps provider-native continuation IDs subordinate to them. */
export class SessionsService {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly store: SessionStore,
    options: SessionsServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    if (input.projectId.trim() === "") {
      throw new InvalidSessionError("Project ID is required.");
    }
    const timestamp = this.now().toISOString();
    const session: SessionRecord = {
      id: input.id ?? this.createId(),
      projectId: input.projectId,
      messages: [],
      continuations: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.title === undefined ? {} : { title: input.title }),
    };
    await this.store.save(session);
    return session;
  }

  async get(sessionId: SessionId): Promise<SessionRecord> {
    const session = await this.store.get(sessionId);
    if (session === undefined) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  /** Saves a complete import in one store mutation, without fabricated runs. */
  async importSnapshot(projectId: string, snapshot: SessionImportSnapshot): Promise<SessionRecord> {
    if (projectId.trim() === "") throw new InvalidSessionError("Project ID is required.");
    const importedAt = this.now().toISOString();
    const session: SessionRecord = {
      id: this.createId(), projectId, title: snapshot.session.title,
      createdAt: snapshot.session.createdAt, updatedAt: snapshot.session.updatedAt,
      messages: snapshot.messages.filter((message) => message.content.trim() !== "").map((message) => ({
        id: this.createId(), role: message.role, content: message.content,
        createdAt: message.createdAt ?? snapshot.session.createdAt,
        metadata: { imported: "true", ...(message.nativeMessageId === undefined ? {} : { nativeMessageId: message.nativeMessageId }),
          ...(message.presentation === undefined ? {} : { presentation: message.presentation }),
          ...(message.thinkingFormat === undefined ? {} : { thinkingFormat: message.thinkingFormat }) },
      })),
      continuations: [],
      importSource: { sourceId: snapshot.session.sourceId, providerName: snapshot.session.providerName,
        nativeSessionId: snapshot.session.nativeSessionId, importedAt },
    };
    await this.store.save(session);
    return session;
  }

  /**
   * Lists sessions, optionally restricted to one project, most recently
   * updated first so navigators show active conversations at the top.
   */
  async list(projectId?: string): Promise<readonly SessionRecord[]> {
    const sessions = await this.store.list();
    return sessions
      .filter((session) => projectId === undefined || session.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async appendMessage(
    sessionId: SessionId,
    input: Omit<SessionMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): Promise<SessionRecord> {
    const session = await this.get(sessionId);
    if (input.content.trim() === "") {
      throw new InvalidSessionError("Session message content is required.");
    }
    const message: SessionMessage = {
      id: input.id ?? this.createId(),
      role: input.role,
      content: input.content,
      createdAt: input.createdAt ?? this.now().toISOString(),
      ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
    };
    const updated: SessionRecord = {
      ...session,
      messages: [...session.messages, message],
      updatedAt: this.now().toISOString(),
    };
    await this.store.save(updated);
    return updated;
  }

  async associateContinuation(
    sessionId: SessionId,
    continuation: NativeContinuationReference,
  ): Promise<SessionRecord> {
    const session = await this.get(sessionId);
    const withoutRuntime = session.continuations.filter(
      (candidate) => candidate.runtimeId !== continuation.runtimeId,
    );
    const updated: SessionRecord = {
      ...session,
      continuations: [...withoutRuntime, { ...continuation }],
      updatedAt: this.now().toISOString(),
    };
    await this.store.save(updated);
    return updated;
  }

  async continuation(
    sessionId: SessionId,
    runtimeId: string,
  ): Promise<NativeContinuationReference | undefined> {
    const session = await this.get(sessionId);
    return session.continuations.find((candidate) => candidate.runtimeId === runtimeId);
  }
}
