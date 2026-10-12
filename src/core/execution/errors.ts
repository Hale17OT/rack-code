export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export class RunNotFoundError extends ExecutionError {
  constructor(runId: string) {
    super(`Run '${runId}' was not found.`);
    this.name = "RunNotFoundError";
  }
}

export class RuntimeNotFoundError extends ExecutionError {
  constructor(runtimeId: string) {
    super(`Runtime '${runtimeId}' was not registered.`);
    this.name = "RuntimeNotFoundError";
  }
}

export class ApprovalNotFoundError extends ExecutionError {
  constructor(approvalId: string) {
    super(`Approval '${approvalId}' is not pending.`);
    this.name = "ApprovalNotFoundError";
  }
}
