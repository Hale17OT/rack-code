import { randomUUID } from "node:crypto";

import { InvalidSessionError, SessionNotFoundError } from "./errors.js";
import type { SessionStore } from "./ports.js";
import { MAX_ATTACHMENTS, type AttachmentStore, type SessionAttachment } from "./attachments.js";
import type {
  CreateSessionInput,
  SessionImportSnapshot,
  NativeContinuationReference,
  SessionId,
  SessionMessage,
  SessionRecord,
} from "./types.js";

export interface SessionsServiceOptions {
  readonly attachments?: AttachmentStore;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** Owns application sessions and keeps provider-native continuation IDs subordinate to them. */
export class SessionsService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly attachments: AttachmentStore | undefined;

  constructor(
    private readonly store: SessionStore,
    options: SessionsServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.attachments = options.attachments;
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

  /** Imports a batch atomically from the caller's perspective, without rewriting session history. */
  async attachFiles(sessionId: SessionId, paths: readonly string[]): Promise<readonly SessionAttachment[]> {
    await this.get(sessionId);
    if (this.attachments === undefined) throw new InvalidSessionError("Attachment storage is unavailable.");
    if (paths.length === 0 || paths.length > MAX_ATTACHMENTS) throw new InvalidSessionError(`Choose between 1 and ${MAX_ATTACHMENTS} files.`);
    const imported: SessionAttachment[] = [];
    try {
      for (const path of paths) imported.push(await this.attachments.importFile(sessionId, path));
      return imported;
    } catch (error) {
      await Promise.allSettled(imported.map((file) => this.attachments!.remove(sessionId, file.id)));
      throw error;
    }
  }

  /** Validates ownership before execution records a run or acquires a writer. */
  async resolveAttachments(sessionId: SessionId, ids: readonly string[]): Promise<readonly SessionAttachment[]> {
    if (ids.length === 0) return [];
    await this.get(sessionId);
    if (this.attachments === undefined) throw new InvalidSessionError("Attachment storage is unavailable.");
    if (ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length) throw new InvalidSessionError("Too many or duplicate attachments.");
    return Promise.all(ids.map((id) => this.attachments!.get(sessionId, id)));
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
    // Replace only the association for this runtime and account context, so
    // switching accounts and back resumes each account's own native thread.
    // Unscoped legacy entries for the runtime are dropped because their
    // owning context is unknown.
    const others = session.continuations.filter(
      (candidate) => candidate.runtimeId !== continuation.runtimeId
        || (candidate.runtimeContextId !== undefined
          && candidate.runtimeContextId !== continuation.runtimeContextId),
    );
    const updated: SessionRecord = {
      ...session,
      continuations: [...others, { ...continuation }],
      updatedAt: this.now().toISOString(),
    };
    await this.store.save(updated);
    return updated;
  }

  /**
   * Returns the native thread this runtime can resume for the given account
   * context. Resuming a thread from another context fails natively (Codex
   * reports "no rollout found for thread id"), so no match means the caller
   * starts a fresh native thread.
   */
  async continuation(
    sessionId: SessionId,
    runtimeId: string,
    runtimeContextId: string,
  ): Promise<NativeContinuationReference | undefined> {
    const session = await this.get(sessionId);
    return session.continuations.find((candidate) =>
      candidate.runtimeId === runtimeId && candidate.runtimeContextId === runtimeContextId);
  }
}
