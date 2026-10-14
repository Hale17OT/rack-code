export type ProjectId = string;

/** Paths are relative to the workspace; '.' keeps an existing subfolder scope. */
export interface ProjectRepositories {
  readonly selectedPath?: string;
  readonly paths: readonly string[];
  readonly limited: boolean;
  readonly warnings: readonly string[];
}

export interface RepositoryDiscoveryOptions {
  readonly rescan?: boolean;
  readonly deep?: boolean;
  /** Explicit folder selection, still constrained to the workspace. */
  readonly repositoryPath?: string;
}

/** Read-only working-tree snapshot; includes user changes, not just agent edits. */
export interface ProjectChanges {
  readonly status: "ready" | "not_git" | "unavailable";
  readonly diff: string;
  readonly truncated: boolean;
}

/** The selected folder, its sessions, and its single editing-run owner. */
export interface ProjectRecord {
  readonly id: ProjectId;
  readonly path: string;
  readonly startingRevision?: string;
  readonly activeWriterAttemptId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly id?: ProjectId;
  readonly path: string;
  readonly startingRevision?: string;
}
