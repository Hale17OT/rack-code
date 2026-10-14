import type { WorkspaceId, WorkspaceRecord } from "./types.js";

export interface WorkspaceStore {
  listWorkspaces(): Promise<readonly WorkspaceRecord[]>;
  getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord | undefined>;
  saveWorkspace(workspace: WorkspaceRecord): Promise<void>;
}
