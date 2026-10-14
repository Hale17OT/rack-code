import { randomUUID } from "node:crypto";

import {
  InvalidWorkspaceError,
  WorkspaceBusyError,
  WorkspaceNotFoundError,
} from "./errors.js";
import type { WorkspaceStore } from "./ports.js";
import type { CreateWorkspaceInput, WorkspaceId, WorkspaceRecord } from "./types.js";

export interface WorkspacesServiceOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/**
 * Owns top-level workspace identity and writer ownership.
 *
 * A workspace is the product's unit of folder context. Sessions, model
 * discovery, execution paths, and concurrency all reference this record
 * directly; there is no parent project entity.
 */
export class WorkspacesService {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly store: WorkspaceStore,
    options: WorkspacesServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    if (input.path.trim() === "") {
      throw new InvalidWorkspaceError("Workspace path is required.");
    }
    const timestamp = this.now().toISOString();
    const workspace: WorkspaceRecord = {
      id: input.id ?? this.createId(),
      path: input.path,
      kind: input.kind ?? "shared",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.startingRevision === undefined ? {} : { startingRevision: input.startingRevision }),
    };
    await this.store.saveWorkspace(workspace);
    return workspace;
  }

  /** Lists workspaces in creation order for the navigator. */
  async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
    const workspaces = await this.store.listWorkspaces();
    return [...workspaces].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord> {
    const workspace = await this.store.getWorkspace(workspaceId);
    if (workspace === undefined) throw new WorkspaceNotFoundError(workspaceId);
    return workspace;
  }

  async acquireWriter(workspaceId: WorkspaceId, attemptId: string): Promise<WorkspaceRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    if (workspace.activeWriterAttemptId !== undefined && workspace.activeWriterAttemptId !== attemptId) {
      throw new WorkspaceBusyError(workspaceId, workspace.activeWriterAttemptId);
    }
    const updated: WorkspaceRecord = {
      ...workspace,
      activeWriterAttemptId: attemptId,
      updatedAt: this.now().toISOString(),
    };
    await this.store.saveWorkspace(updated);
    return updated;
  }

  async releaseWriter(workspaceId: WorkspaceId, attemptId: string): Promise<WorkspaceRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    if (workspace.activeWriterAttemptId !== undefined && workspace.activeWriterAttemptId !== attemptId) {
      throw new WorkspaceBusyError(workspaceId, workspace.activeWriterAttemptId);
    }
    const { activeWriterAttemptId: _activeWriterAttemptId, ...withoutWriter } = workspace;
    const updated: WorkspaceRecord = { ...withoutWriter, updatedAt: this.now().toISOString() };
    await this.store.saveWorkspace(updated);
    return updated;
  }
}
