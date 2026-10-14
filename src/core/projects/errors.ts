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

export class ProjectBusyError extends ProjectError {
  /** Exposed so clients can show the owning attempt without parsing text. */
  constructor(readonly projectId: string, readonly attemptId: string) {
    super(`Project '${projectId}' is already being edited by attempt '${attemptId}'.`);
    this.name = "ProjectBusyError";
  }
}

export class InvalidProjectError extends ProjectError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectError";
  }
}
