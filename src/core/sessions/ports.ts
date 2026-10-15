import type { SessionId, SessionRecord } from "./types.js";

export interface SessionStore {
  list(): Promise<readonly SessionRecord[]>;
  get(sessionId: SessionId): Promise<SessionRecord | undefined>;
  save(session: SessionRecord): Promise<void>;
  /** Removes the saved conversation; execution audit and artifacts have separate owners. */
  remove(sessionId: SessionId): Promise<void>;
}
