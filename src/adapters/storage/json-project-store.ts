import { JsonFileDocument } from "./json-file.js";
import type { ProjectStore } from "../../core/projects/ports.js";
import type {
  ProjectId,
  ProjectRecord,
  WorkspaceId,
  WorkspaceRecord,
} from "../../core/projects/types.js";

interface ProjectDocument {
  readonly schemaVersion: 1;
  readonly projects: ProjectRecord[];
  readonly workspaces: WorkspaceRecord[];
}

/** Durable local project and workspace metadata store. */
export class JsonProjectStore implements ProjectStore {
  private readonly document: JsonFileDocument<ProjectDocument>;

  constructor(filePath: string) {
    this.document = new JsonFileDocument<ProjectDocument>(filePath, {
      schemaVersion: 1,
      projects: [],
      workspaces: [],
    });
  }

  async listProjects(): Promise<readonly ProjectRecord[]> {
    return (await this.document.read()).projects;
  }

  async getProject(projectId: ProjectId): Promise<ProjectRecord | undefined> {
    return (await this.document.read()).projects.find((project) => project.id === projectId);
  }

  async saveProject(project: ProjectRecord): Promise<void> {
    await this.document.update((current) => ({
      ...current,
      projects: [
        ...current.projects.filter((candidate) => candidate.id !== project.id),
        project,
      ],
    }));
  }

  async listWorkspaces(projectId?: ProjectId): Promise<readonly WorkspaceRecord[]> {
    return (await this.document.read()).workspaces.filter(
      (workspace) => projectId === undefined || workspace.projectId === projectId,
    );
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord | undefined> {
    return (await this.document.read()).workspaces.find((workspace) => workspace.id === workspaceId);
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
}
