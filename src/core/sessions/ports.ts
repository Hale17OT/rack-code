import type { SessionId, SessionRecord } from "./types.js";

export interface SessionStore {
  list(): Promise<readonly SessionRecord[]>;
  get(sessionId: SessionId): Promise<SessionRecord | undefined>;
  save(session: SessionRecord): Promise<void>;
}
