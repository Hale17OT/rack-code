import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryProjectStore } from "./in-memory-store.js";
import { ProjectsService } from "./service.js";

test("adding the same folder again reuses its project and writer ownership", async () => {
  const projects = new ProjectsService(new InMemoryProjectStore());
  const first = await projects.createProject({ path: "/tmp/demo" });
  await projects.acquireWriter(first.id, "active-attempt");
  const repeated = await projects.createProject({ path: "/tmp/demo/../demo/" });
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.activeWriterAttemptId, "active-attempt");
  assert.equal((await projects.listProjects()).length, 1);
});

test("concurrent requests to add one folder create only one project", async () => {
  const projects = new ProjectsService(new InMemoryProjectStore());
  const added = await Promise.all([
    projects.createProject({ path: "/tmp/demo" }),
    projects.createProject({ path: "/tmp/demo/" }),
  ]);
  assert.equal(added[0]?.id, added[1]?.id);
  assert.equal((await projects.listProjects()).length, 1);
  const [first, second] = await Promise.allSettled([
    projects.acquireWriter(added[0]!.id, "first-writer"),
    projects.acquireWriter(added[0]!.id, "second-writer"),
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
});
