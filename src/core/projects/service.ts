import { randomUUID } from "node:crypto";

import {
  InvalidProjectError,
  ProjectNotFoundError,
  WorkspaceBusyError,
  WorkspaceNotFoundError,
} from "./errors.js";
import type { ProjectStore } from "./ports.js";
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  ProjectId,
  ProjectRecord,
  WorkspaceId,
  WorkspaceRecord,
} from "./types.js";

export interface ProjectsServiceOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/**
 * Owns project identity and workspace writer ownership.
 *
 * A shared workspace has at most one editing attempt at a time. The lock is
 * persisted with the workspace record so a later execution host can inspect
 * and recover it rather than relying on a process-local mutex.
 */
export class ProjectsService {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly store: ProjectStore,
    options: ProjectsServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    if (input.name.trim() === "" || input.rootPath.trim() === "") {
      throw new InvalidProjectError("Project name and root path are required.");
    }
    const timestamp = this.now().toISOString();
    const project: ProjectRecord = {
      id: input.id ?? this.createId(),
      name: input.name,
      rootPath: input.rootPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.store.saveProject(project);
    return project;
  }

  async getProject(projectId: ProjectId): Promise<ProjectRecord> {
    const project = await this.store.getProject(projectId);
    if (project === undefined) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  /** Lists saved projects in creation order for navigators and pickers. */
  async listProjects(): Promise<readonly ProjectRecord[]> {
    const projects = await this.store.listProjects();
    return [...projects].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  /**
   * Lists workspaces for one project in creation order. The returned records
   * include the persisted writer lock so a UI can show the owning attempt.
   */
  async listWorkspaces(projectId: ProjectId): Promise<readonly WorkspaceRecord[]> {
    await this.getProject(projectId);
    const workspaces = await this.store.listWorkspaces(projectId);
    return [...workspaces].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    await this.getProject(input.projectId);
    if (input.path.trim() === "") {
      throw new InvalidProjectError("Workspace path is required.");
    }
    const timestamp = this.now().toISOString();
    const workspace: WorkspaceRecord = {
      id: input.id ?? this.createId(),
      projectId: input.projectId,
      path: input.path,
      kind: input.kind ?? "shared",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.startingRevision === undefined
        ? {}
        : { startingRevision: input.startingRevision }),
    };
    await this.store.saveWorkspace(workspace);
    return workspace;
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord> {
    const workspace = await this.store.getWorkspace(workspaceId);
    if (workspace === undefined) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return workspace;
  }

  async acquireWriter(workspaceId: WorkspaceId, attemptId: string): Promise<WorkspaceRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    if (
      workspace.activeWriterAttemptId !== undefined &&
      workspace.activeWriterAttemptId !== attemptId
    ) {
      throw new WorkspaceBusyError(workspaceId, workspace.activeWriterAttemptId);
    }
    const updated = this.withWriter(workspace, attemptId);
    await this.store.saveWorkspace(updated);
    return updated;
  }

  async releaseWriter(workspaceId: WorkspaceId, attemptId: string): Promise<WorkspaceRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    if (workspace.activeWriterAttemptId !== undefined && workspace.activeWriterAttemptId !== attemptId) {
      throw new WorkspaceBusyError(workspaceId, workspace.activeWriterAttemptId);
    }
    const { activeWriterAttemptId: _activeWriterAttemptId, ...withoutWriter } = workspace;
    const updated: WorkspaceRecord = {
      ...withoutWriter,
      updatedAt: this.now().toISOString(),
    };
    await this.store.saveWorkspace(updated);
    return updated;
  }

  private withWriter(workspace: WorkspaceRecord, attemptId: string): WorkspaceRecord {
    return {
      ...workspace,
      activeWriterAttemptId: attemptId,
      updatedAt: this.now().toISOString(),
    };
  }
}
