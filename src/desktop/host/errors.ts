/**
 * Maps domain and contract errors to stable `HostErrorPayload` codes.
 *
 * This is the only place that knows the mapping, so adding a domain error
 * class means adding one branch here. Anything unrecognized becomes
 * `internal`; its message is still returned because the host and the user
 * are on the same machine and the text helps diagnosis.
 */
import {
  AccountNotFoundError,
  AccountProviderMismatchError,
  DuplicateAccountError,
  InvalidAccountError,
} from "../../core/accounts/errors.js";
import {
  ApprovalNotFoundError,
  AttemptNotFoundError,
  NoEligibleAccountError,
  RunNotFoundError,
  RuntimeNotFoundError,
  WorkspaceProjectMismatchError,
} from "../../core/execution/errors.js";
import {
  InvalidProjectError,
  ProjectNotFoundError,
  WorkspaceBusyError,
  WorkspaceNotFoundError,
} from "../../core/projects/errors.js";
import { InvalidSessionError, SessionNotFoundError } from "../../core/sessions/errors.js";
import { ConnectNotFoundError, ConnectorNotFoundError } from "../../core/connections/errors.js";
import type { HostErrorCode, HostErrorPayload } from "../../contracts/desktop/errors.js";
import { ContractValidationError } from "../../contracts/desktop/validation.js";

/** Raised by the host for conditions that have no domain error class. */
export class HostOperationError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "HostOperationError";
  }
}

export function toHostError(error: unknown): HostErrorPayload {
  if (!(error instanceof Error)) {
    return { code: "internal", name: "Error", message: String(error) };
  }
  const base = { name: error.name, message: error.message };
  if (error instanceof HostOperationError) {
    return { ...base, code: error.code, ...(error.details === undefined ? {} : { details: error.details }) };
  }
  if (error instanceof DuplicateAccountError) {
    return {
      ...base,
      code: "duplicate_account",
      details: { providerId: error.providerId, providerAccountId: error.providerAccountId },
    };
  }
  if (error instanceof WorkspaceBusyError) {
    return {
      ...base,
      code: "workspace_busy",
      details: { workspaceId: error.workspaceId, attemptId: error.attemptId },
    };
  }
  return { ...base, code: codeFor(error) };
}

function codeFor(error: Error): HostErrorCode {
  if (
    error instanceof ContractValidationError ||
    error instanceof InvalidAccountError ||
    error instanceof InvalidProjectError ||
    error instanceof InvalidSessionError
  ) {
    return "invalid_input";
  }
  if (error instanceof AccountProviderMismatchError) return "provider_mismatch";
  if (error instanceof AccountNotFoundError) return "account_not_found";
  if (error instanceof NoEligibleAccountError) return "no_eligible_account";
  if (error instanceof ProjectNotFoundError) return "project_not_found";
  if (error instanceof WorkspaceNotFoundError) return "workspace_not_found";
  if (error instanceof WorkspaceProjectMismatchError) return "workspace_project_mismatch";
  if (error instanceof SessionNotFoundError) return "session_not_found";
  if (error instanceof RuntimeNotFoundError) return "runtime_not_found";
  if (error instanceof RunNotFoundError) return "run_not_found";
  if (error instanceof AttemptNotFoundError) return "attempt_not_found";
  if (error instanceof ApprovalNotFoundError) return "approval_not_found";
  if (error instanceof ConnectorNotFoundError) return "connector_not_found";
  if (error instanceof ConnectNotFoundError) return "connect_not_found";
  return "internal";
}
