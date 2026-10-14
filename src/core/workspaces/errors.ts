export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export class WorkspaceNotFoundError extends WorkspaceError {
  constructor(workspaceId: string) {
    super(`Workspace '${workspaceId}' was not found.`);
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceBusyError extends WorkspaceError {
  /** Exposed so clients can show the owning attempt without parsing text. */
  constructor(readonly workspaceId: string, readonly attemptId: string) {
    super(`Workspace '${workspaceId}' is already being edited by attempt '${attemptId}'.`);
    this.name = "WorkspaceBusyError";
  }
}

export class InvalidWorkspaceError extends WorkspaceError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkspaceError";
  }
}
