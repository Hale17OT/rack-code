import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { AsyncQueue } from "../../core/shared/async-queue.js";
import type {
  AccountConnector,
  ConnectAttempt,
  ConnectContext,
  ConnectEvent,
  ConnectedIdentity,
} from "../../core/connections/ports.js";

/** Variables that would override the account's subscription login. */
const BLOCKED_ENVIRONMENT = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

/**
 * "Connect Claude account": claude.ai subscription sign-in through the
 * Claude Code CLI that the Agent SDK runs.
 *
 * Flow:
 * 1. Run `claude auth login --claudeai` with `CLAUDE_CONFIG_DIR` set to the
 *    account's private runtime-context directory. Per the Claude Code
 *    authentication docs, the login for that directory is stored there (on
 *    macOS, in a Keychain entry keyed to the directory), which is exactly
 *    where the runtime adapter points the SDK.
 * 2. The CLI opens the sign-in page itself; any URL it prints is forwarded
 *    so the UI can offer it again. If the CLI asks for a pasted code, the UI
 *    shows a code field and `submitCode` writes it to the CLI's stdin.
 * 3. After the CLI exits successfully, `claude auth status --json` (same
 *    directory) reports the identity.
 *
 * The CLI's interactive output is not a stable protocol, so URL and prompt
 * detection is deliberately loose. API-key variables are removed from the
 * environment so they cannot override the subscription login.
 */
export class ClaudeConnector implements AccountConnector {
  readonly providerId = "claude";
  readonly displayName = "Claude";

  constructor(private readonly command = "claude") {}

  connect(context: ConnectContext): ConnectAttempt {
    const events = new AsyncQueue<ConnectEvent>();
    const environment = claudeEnvironment(context);
    const child = spawn(this.command, ["auth", "login", "--claudeai"], {
      cwd: context.directory,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stopped = false;
    let announcedUrl = false;
    let askedForCode = false;
    let output = "";

    const onOutput = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString("utf8"));
      // Keep a bounded tail for error messages.
      output = (output + text).slice(-4000);
      const url = text.match(/https:\/\/\S+/)?.[0];
      if (url !== undefined && !announcedUrl) {
        announcedUrl = true;
        // The CLI opens the sign-in page itself; the URL is offered as a fallback.
        events.push({ type: "browser", url: url.replace(/[)\].,]+$/, ""), opened: true });
      }
      if (!askedForCode && /paste|authorization code|enter.*code/i.test(text)) {
        askedForCode = true;
        events.push({ type: "code_required" });
      }
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);

    child.on("error", (error) => {
      if (!stopped) events.push({ type: "failed", error: `Could not start Claude Code: ${error.message}` });
      events.complete();
    });
    child.on("close", (code) => {
      if (stopped) {
        events.complete();
        return;
      }
      if (code !== 0) {
        events.push({ type: "failed", error: lastLines(output) || `Claude sign-in exited with code ${code ?? "unknown"}.` });
        events.complete();
        return;
      }
      void readIdentity(this.command, context.directory, environment).then(
        (identity) => events.push({ type: "completed", identity }),
        (error: unknown) => events.push({ type: "failed", error: error instanceof Error ? error.message : String(error) }),
      ).finally(() => events.complete());
    });

    return {
      events,
      submitCode: (code) => {
        if (!child.stdin.destroyed) child.stdin.write(`${code.trim()}\n`);
      },
      cancel: async () => {
        if (stopped) return;
        stopped = true;
        if (child.exitCode === null) child.kill();
      },
    };
  }
}

/** Reads the signed-in identity for one config directory. */
async function readIdentity(
  command: string,
  directory: string,
  environment: NodeJS.ProcessEnv,
): Promise<ConnectedIdentity> {
  const output = await run(command, ["auth", "status", "--json"], directory, environment);
  let status: Record<string, unknown>;
  try {
    status = JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error("Claude Code returned an unreadable sign-in status.");
  }
  if (status["loggedIn"] !== true) {
    throw new Error("Claude Code reports that sign-in did not complete.");
  }
  const email = firstString(status, ["email", "emailAddress", "userEmail"]);
  const accountId = firstString(status, ["accountUuid", "accountId", "userId"]) ?? email;
  if (accountId === undefined) {
    throw new Error("Claude Code signed in but did not report an account identity.");
  }
  const plan = firstString(status, ["subscriptionType", "plan", "orgName"]);
  const displayName = firstString(status, ["displayName", "name"]);
  return {
    providerAccountId: accountId,
    ...(email === undefined ? {} : { email }),
    ...(displayName === undefined ? {} : { displayName }),
    ...(plan === undefined ? {} : { plan }),
  };
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(command, [...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdin.end();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", () => undefined);
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
  });
}

function claudeEnvironment(context: ConnectContext): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...context.environment };
  for (const name of BLOCKED_ENVIRONMENT) delete environment[name];
  environment["CLAUDE_CONFIG_DIR"] = context.directory;
  return environment;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

function lastLines(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3).join(" ");
}
