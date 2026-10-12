import { JsonFileDocument } from "./json-file.js";
import type { SessionStore } from "../../core/sessions/ports.js";
import type { SessionId, SessionRecord } from "../../core/sessions/types.js";

interface SessionDocument {
  readonly schemaVersion: 1;
  readonly sessions: SessionRecord[];
}

/** Durable local session store with a versioned document envelope. */
export class JsonSessionStore implements SessionStore {
  private readonly document: JsonFileDocument<SessionDocument>;

  constructor(filePath: string) {
    this.document = new JsonFileDocument<SessionDocument>(filePath, {
      schemaVersion: 1,
      sessions: [],
    });
  }

  async list(): Promise<readonly SessionRecord[]> {
    return (await this.document.read()).sessions;
  }

  async get(sessionId: SessionId): Promise<SessionRecord | undefined> {
    return (await this.document.read()).sessions.find((session) => session.id === sessionId);
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
}
