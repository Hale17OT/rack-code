import type { ProjectStore } from "./ports.js";
import type { ProjectId, ProjectRecord, WorkspaceId, WorkspaceRecord } from "./types.js";

/** Headless store used by unit tests until the durable project store is composed. */
export class InMemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<ProjectId, ProjectRecord>();
  private readonly workspaces = new Map<WorkspaceId, WorkspaceRecord>();

  async listProjects(): Promise<readonly ProjectRecord[]> {
    return [...this.projects.values()].map((project) => ({ ...project }));
  }

  async getProject(projectId: ProjectId): Promise<ProjectRecord | undefined> {
    const project = this.projects.get(projectId);
    return project === undefined ? undefined : { ...project };
  }

  async saveProject(project: ProjectRecord): Promise<void> {
    this.projects.set(project.id, { ...project });
  }

  async listWorkspaces(projectId?: ProjectId): Promise<readonly WorkspaceRecord[]> {
    return [...this.workspaces.values()]
      .filter((workspace) => projectId === undefined || workspace.projectId === projectId)
      .map((workspace) => ({ ...workspace }));
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord | undefined> {
    const workspace = this.workspaces.get(workspaceId);
    return workspace === undefined ? undefined : { ...workspace };
  }

  async saveWorkspace(workspace: WorkspaceRecord): Promise<void> {
    this.workspaces.set(workspace.id, { ...workspace });
  }
}
