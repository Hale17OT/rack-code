import type { ProjectChanges, ProjectId, ProjectRecord, ProjectRepositories, RepositoryDiscoveryOptions } from "./types.js";

/** Platform adapters supply current changes without mutating the project. */
export interface ProjectChangesReader {
  read(path: string): Promise<ProjectChanges>;
  discover(path: string, options: RepositoryDiscoveryOptions): Promise<ProjectRepositories>;
  readRepository(path: string, repositoryPath: string): Promise<ProjectChanges>;
}

export interface ProjectStore {
  listProjects(): Promise<readonly ProjectRecord[]>;
  getProject(projectId: ProjectId): Promise<ProjectRecord | undefined>;
  saveProject(project: ProjectRecord): Promise<void>;
}
