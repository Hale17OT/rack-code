export type ProjectId = string;
export type WorkspaceId = string;

export interface ProjectRecord {
  readonly id: ProjectId;
  readonly name: string;
  readonly rootPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkspaceKind = "shared" | "isolated";

export interface WorkspaceRecord {
  readonly id: WorkspaceId;
  readonly projectId: ProjectId;
  readonly path: string;
  readonly kind: WorkspaceKind;
  readonly startingRevision?: string;
  readonly activeWriterAttemptId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly id?: ProjectId;
  readonly name: string;
  readonly rootPath: string;
}

export interface CreateWorkspaceInput {
  readonly id?: WorkspaceId;
  readonly projectId: ProjectId;
  readonly path: string;
  readonly kind?: WorkspaceKind;
  readonly startingRevision?: string;
}
