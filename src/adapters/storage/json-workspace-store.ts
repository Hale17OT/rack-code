import { JsonFileDocument } from "./json-file.js";
import type { WorkspaceStore } from "../../core/workspaces/ports.js";
import type { WorkspaceRecord, WorkspaceId } from "../../core/workspaces/types.js";

interface WorkspaceDocument {
  readonly schemaVersion: 2;
  readonly workspaces: WorkspaceRecord[];
}

interface LegacyProjectDocument {
  readonly schemaVersion?: number;
  readonly projects?: readonly { readonly id: string; readonly rootPath: string; readonly createdAt: string; readonly updatedAt: string }[];
  readonly workspaces?: readonly (WorkspaceRecord & { readonly projectId?: string })[];
}

/**
 * Durable workspace metadata store.
 *
 * The first MVP stored projects and child workspaces together in
 * `projects.json`. The one-time read fallback keeps those folders available
 * after the model becomes workspace-only; all new writes use `workspaces.json`
 * and omit the obsolete project relationship.
 */
export class JsonWorkspaceStore implements WorkspaceStore {
  private readonly document: JsonFileDocument<WorkspaceDocument>;
  private readonly legacyFilePath: string;

  constructor(filePath: string, legacyFilePath?: string) {
    this.document = new JsonFileDocument<WorkspaceDocument>(filePath, {
      schemaVersion: 2,
      workspaces: [],
    });
    this.legacyFilePath = legacyFilePath ?? filePath.replace(/workspaces\.json$/, "projects.json");
  }

  async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
    const current = await this.document.read();
    if (current.workspaces.length > 0) return current.workspaces;
    return this.readLegacyWorkspaces();
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord | undefined> {
    return (await this.listWorkspaces()).find((workspace) => workspace.id === workspaceId);
  }

  async saveWorkspace(workspace: WorkspaceRecord): Promise<void> {
    await this.document.update((current) => ({
      ...current,
      workspaces: [
        ...current.workspaces.filter((candidate) => candidate.id !== workspace.id),
        workspace,
      ],
    }));
  }

  private async readLegacyWorkspaces(): Promise<readonly WorkspaceRecord[]> {
    try {
      const legacy = new JsonFileDocument<LegacyProjectDocument>(this.legacyFilePath, {
        schemaVersion: 1,
        projects: [],
        workspaces: [],
      });
      const document = await legacy.read();
      return (document.workspaces ?? []).map(({ projectId: _projectId, ...workspace }) => workspace);
    } catch {
      return [];
    }
  }
}
