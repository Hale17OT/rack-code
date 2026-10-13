export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export class ProjectNotFoundError extends ProjectError {
  constructor(projectId: string) {
    super(`Project '${projectId}' was not found.`);
    this.name = "ProjectNotFoundError";
  }
}

export class WorkspaceNotFoundError extends ProjectError {
  constructor(workspaceId: string) {
    super(`Workspace '${workspaceId}' was not found.`);
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceBusyError extends ProjectError {
  /** Exposed so clients can show the owning attempt without parsing text. */
  constructor(readonly workspaceId: string, readonly attemptId: string) {
    super(`Workspace '${workspaceId}' is already being edited by attempt '${attemptId}'.`);
    this.name = "WorkspaceBusyError";
  }
}

export class InvalidProjectError extends ProjectError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectError";
  }
}
