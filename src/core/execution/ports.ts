import type { AttemptId, AttemptRecord, JournalEntry, RunId, RunRecord } from "./types.js";

export interface ExecutionStore {
  getRun(runId: RunId): Promise<RunRecord | undefined>;
  /** Lists runs that belong to one application session, in any order. */
  listRuns(sessionId: string): Promise<readonly RunRecord[]>;
  saveRun(run: RunRecord): Promise<void>;
  getAttempt(attemptId: AttemptId): Promise<AttemptRecord | undefined>;
  saveAttempt(attempt: AttemptRecord): Promise<void>;
  appendJournal(entry: Omit<JournalEntry, "sequence">): Promise<JournalEntry>;
  listJournal(runId: RunId): Promise<readonly JournalEntry[]>;
}
