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
  /** Current branch label; detached checkouts use their short revision. */
  readonly branch?: string;
  /** Separate index/working-tree entries; one path may occur in both groups. */
  readonly files?: readonly ProjectChangeFile[];
}

export type ProjectChangeStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted" | "type_changed";
export type ProjectChangeGroup = "staged" | "changes" | "conflicts";

/** Provider-neutral file change, scoped to the selected repository/project folder. */
export interface ProjectChangeFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ProjectChangeStatus;
  readonly group: ProjectChangeGroup;
  readonly diff: string;
  readonly notice?: string;
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
