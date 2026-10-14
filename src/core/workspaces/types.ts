export type WorkspaceId = string;

export type WorkspaceKind = "shared" | "isolated";

/** A top-level folder where sessions and agent runs operate. */
export interface WorkspaceRecord {
  readonly id: WorkspaceId;
  readonly path: string;
  readonly kind: WorkspaceKind;
  readonly startingRevision?: string;
  readonly activeWriterAttemptId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateWorkspaceInput {
  readonly id?: WorkspaceId;
  readonly path: string;
  readonly kind?: WorkspaceKind;
  readonly startingRevision?: string;
}
