import type { ProjectId, ProjectRecord, WorkspaceId, WorkspaceRecord } from "./types.js";

export interface ProjectStore {
  listProjects(): Promise<readonly ProjectRecord[]>;
  getProject(projectId: ProjectId): Promise<ProjectRecord | undefined>;
  saveProject(project: ProjectRecord): Promise<void>;
  listWorkspaces(projectId?: ProjectId): Promise<readonly WorkspaceRecord[]>;
  getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord | undefined>;
  saveWorkspace(workspace: WorkspaceRecord): Promise<void>;
}
