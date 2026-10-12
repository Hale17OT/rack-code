import { JsonFileDocument } from "./json-file.js";
import type { ExecutionStore } from "../../core/execution/ports.js";
import type { AttemptId, AttemptRecord, JournalEntry, RunId, RunRecord } from "../../core/execution/types.js";

interface ExecutionDocument {
  readonly schemaVersion: 1;
  readonly runs: RunRecord[];
  readonly attempts: AttemptRecord[];
  readonly journal: JournalEntry[];
}

/** Durable execution snapshots and append-only journal for the local MVP. */
export class JsonExecutionStore implements ExecutionStore {
  private readonly document: JsonFileDocument<ExecutionDocument>;

  constructor(filePath: string) {
    this.document = new JsonFileDocument<ExecutionDocument>(filePath, {
      schemaVersion: 1,
      runs: [],
      attempts: [],
      journal: [],
    });
  }

  async getRun(runId: RunId): Promise<RunRecord | undefined> {
    return (await this.document.read()).runs.find((run) => run.id === runId);
  }

  async saveRun(run: RunRecord): Promise<void> {
    await this.document.update((current) => ({
      ...current,
      runs: [...current.runs.filter((candidate) => candidate.id !== run.id), run],
    }));
  }

  async getAttempt(attemptId: AttemptId): Promise<AttemptRecord | undefined> {
    return (await this.document.read()).attempts.find((attempt) => attempt.id === attemptId);
  }

  async saveAttempt(attempt: AttemptRecord): Promise<void> {
    await this.document.update((current) => ({
      ...current,
      attempts: [
        ...current.attempts.filter((candidate) => candidate.id !== attempt.id),
        attempt,
      ],
    }));
  }

  async appendJournal(entry: Omit<JournalEntry, "sequence">): Promise<JournalEntry> {
    const document = await this.document.update((current) => {
      const stored: JournalEntry = {
        ...entry,
        sequence: current.journal.length + 1,
      };
      return { ...current, journal: [...current.journal, stored] };
    });
    return document.journal[document.journal.length - 1] as JournalEntry;
  }

  async listJournal(runId: RunId): Promise<readonly JournalEntry[]> {
    return (await this.document.read()).journal.filter((entry) => entry.runId === runId);
  }
}
