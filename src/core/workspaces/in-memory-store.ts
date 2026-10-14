import type { WorkspaceStore } from "./ports.js";
import type { WorkspaceId, WorkspaceRecord } from "./types.js";

/** Headless store used by unit tests and embedded callers. */
export class InMemoryWorkspaceStore implements WorkspaceStore {
  private readonly workspaces = new Map<WorkspaceId, WorkspaceRecord>();

  async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
    return [...this.workspaces.values()].map((workspace) => ({ ...workspace }));
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord | undefined> {
    const workspace = this.workspaces.get(workspaceId);
    return workspace === undefined ? undefined : { ...workspace };
  }

  async saveWorkspace(workspace: WorkspaceRecord): Promise<void> {
    this.workspaces.set(workspace.id, { ...workspace });
  }
}
