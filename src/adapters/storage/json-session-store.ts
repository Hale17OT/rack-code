import { JsonFileDocument } from "./json-file.js";
import type { SessionStore } from "../../core/sessions/ports.js";
import type { SessionId, SessionRecord } from "../../core/sessions/types.js";

interface SessionDocument {
  readonly schemaVersion: 3;
  readonly sessions: SessionRecord[];
}

type LegacySession = Omit<SessionRecord, "projectId"> & { projectId?: string; workspaceId?: string };

/** Durable sessions; schema 3 folds duplicate folder IDs into one project. */
export class JsonSessionStore implements SessionStore {
  private readonly document: JsonFileDocument<SessionDocument>;

  constructor(filePath: string, resolveProjectId: (id: string) => Promise<string> = async (id) => id) {
    this.document = new JsonFileDocument<SessionDocument>(filePath, {
      schemaVersion: 3,
      sessions: [],
    }, async (stored) => {
      const current = stored as SessionDocument;
      const version = (stored as { schemaVersion: number }).schemaVersion;
      if (version === 3) return current;
      if (version !== 1 && version !== 2) {
        throw new Error("Unsupported sessions schema version.");
      }
      return {
        schemaVersion: 3,
        // Both older formats identify the actual folder with workspaceId.
        // It takes precedence over the obsolete parent projectId. Native
        // continuations and messages stay untouched for provider resume.
        sessions: await Promise.all(current.sessions.map(async (session) => {
          const { workspaceId, ...rest } = session as LegacySession;
          const projectId = workspaceId ?? rest.projectId;
          if (projectId === undefined || projectId.trim() === "") {
            throw new Error(`Session '${session.id}' has no saved project folder reference.`);
          }
          return { ...rest, projectId: await resolveProjectId(projectId) };
        })),
      };
    });
  }

  async list(): Promise<readonly SessionRecord[]> {
    return (await this.document.read()).sessions;
  }

  async get(sessionId: SessionId): Promise<SessionRecord | undefined> {
    return this.document.select((value) => value.sessions.find((session) => session.id === sessionId));
  }

  async save(session: SessionRecord): Promise<void> {
    await this.document.update((current) => ({
      ...current,
      sessions: [
        ...current.sessions.filter((candidate) => candidate.id !== session.id),
        session,
      ],
    }));
  }

  async remove(sessionId: SessionId): Promise<void> {
    await this.document.update((current) => ({
      ...current,
      sessions: current.sessions.filter((session) => session.id !== sessionId),
    }));
  }
}
