/**
 * Run composer: one card with an auto-growing prompt and a single toolbar of
 * compact pill menus (permission, runtime, account, model) and a round send
 * button. Details that used to sit in the composer now live in the menus:
 *
 * - Permission options describe what each mode does and show the
 *   adapter-reported native mapping. Modes that need interactive approvals
 *   are disabled, with the reason, when the runtime reports
 *   `approvals: false`. Nothing is inferred from runtime or provider names.
 * - Runtime options list the capability flags returned by
 *   `runtimes.capabilities` for the effective account.
 * - The account menu groups accounts by provider. Each provider starts with
 *   an "Auto" entry, which lets the host choose the selected account or fall
 *   back; the account actually used is shown on the run after it starts.
 * - The model pill opens a small editor; empty means the runtime default.
 *
 * While the session has an active run, the send button becomes a stop
 * button that cancels it. If the session's latest run ended `unknown`,
 * a banner above the card blocks new runs until the user acknowledges it.
 *
 * Enter sends; Shift+Enter inserts a newline.
 */
import {
  PERMISSION_MODES,
  type AccountView,
  type PermissionMode,
  type RuntimeCapabilities,
} from "../../../contracts/desktop/index.js";
import { createDropdown, type DropdownOption } from "../components/dropdown.js";
import { openPopover } from "../components/popover.js";
import type { Controller } from "../controller.js";
import { h, replace } from "../dom.js";
import { icon } from "../icons.js";
import type { AppState, Store } from "../store.js";
import { accountLabel, isActiveStatus, PERMISSION_LABELS } from "./run-format.js";

/** Account menu values: `auto:<provider>` or `account:<provider>:<accountId>`. */
type AccountChoice = `auto:${string}` | `account:${string}:${string}`;

const CAPABILITY_LABELS: ReadonlyArray<readonly [keyof RuntimeCapabilities, string]> = [
  ["resume", "resume"],
  ["fork", "fork"],
  ["approvals", "approvals"],
  ["quotaReporting", "quota"],
  ["browserTools", "browser"],
  ["computerUse", "computer use"],
];

const MODE_ICONS: Readonly<Record<PermissionMode, Parameters<typeof icon>[0]>> = {
  read_only: "lock-simple",
  ask: "hand",
  approve_for_me: "shield-check",
  full_access: "lightning",
};

export function mountComposer(root: HTMLElement, store: Store, controller: Controller): void {
  let mode: PermissionMode = "ask";
  let model = "";
  let submitting = false;

  const permission = createDropdown<PermissionMode>({
    ariaLabel: "Permission mode",
    variant: "pill",
    icon: "shield",
    menuWidth: 340,
    onChange: (value) => {
      mode = value;
      refresh(store.get());
    },
  });
  const runtime = createDropdown<string>({
    ariaLabel: "Runtime",
    variant: "pill",
    icon: "cpu",
    menuWidth: 300,
    onChange: () => refresh(store.get()),
  });
  const account = createDropdown<AccountChoice>({
    ariaLabel: "Account",
    variant: "pill",
    icon: "user",
    placeholder: "No accounts",
    menuWidth: 280,
    // The pill must name the provider, since "Auto" exists once per provider.
    formatValue: (option) => `${option.group ?? ""} · ${option.label.toLowerCase() === "auto" ? "auto" : option.label}`,
    onChange: () => refresh(store.get()),
  });
  const modelButton = h("button", {
    class: "dropdown dropdown-pill",
    type: "button",
    aria: { label: "Model" },
    onClick: () => openModelEditor(),
  }, icon("robot", { className: "dropdown-icon" }), h("span", { class: "dropdown-value" }), icon("caret-up-down", { className: "dropdown-caret" }));

  // Shown instead of the account menu until an account is connected.
  const connectPill = h("button", {
    class: "dropdown dropdown-pill",
    type: "button",
    onClick: () => controller.openSettings("accounts"),
  }, icon("plugs", { className: "dropdown-icon" }), h("span", { class: "dropdown-value" }, "Connect an account"));

  const prompt = h("textarea", {
    class: "prompt-input",
    rows: 1,
    placeholder: "Ask the agent to do something",
    aria: { label: "Prompt" },
  });
  const send = h("button", { class: "send-button", type: "submit" });
  const guard = h("div", { class: "guard" });

  const form = h("form", { class: "composer", onSubmit: (event) => {
    event.preventDefault();
    void submitOrStop();
  } },
    guard,
    h("div", { class: "composer-card" },
      prompt,
      h("div", { class: "composer-toolbar" },
        h("div", { class: "composer-pills" }, permission.element, runtime.element, account.element, connectPill, modelButton),
        send,
      ),
    ),
  );
  root.append(form);

  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitOrStop();
    }
  });
  prompt.addEventListener("input", () => {
    autoGrow();
    refresh(store.get());
  });

  function autoGrow(): void {
    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(prompt.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  function openModelEditor(): void {
    const input = h("input", { type: "text", value: model, placeholder: "Runtime default", aria: { label: "Model" } });
    const apply = () => {
      model = input.value.trim();
      handle.close();
      modelButton.focus();
      refresh(store.get());
    };
    const content = h("form", { class: "popover-form", onSubmit: (event) => {
      event.preventDefault();
      apply();
    } },
      h("span", { class: "label" }, "Model"),
      input,
      h("p", { class: "form-note" }, "Leave empty to use the runtime's default model."),
      h("div", { class: "form-actions" },
        h("button", { class: "button", type: "button", onClick: () => {
          input.value = "";
          apply();
        } }, "Default"),
        h("button", { class: "button button-primary", type: "submit" }, "Apply"),
      ),
    );
    const handle = openPopover({ anchor: modelButton, content, minWidth: 260 });
    input.focus();
    input.select();
  }

  /** Active run of the open session, if any; the send button cancels it. */
  function activeRunId(state: AppState): string | undefined {
    return Object.values(state.live).find((live) =>
      live.run.sessionId === state.session?.id && isActiveStatus(live.run.status))?.run.id;
  }

  async function submitOrStop(): Promise<void> {
    const state = store.get();
    const active = activeRunId(state);
    if (active !== undefined) {
      if (!state.live[active]?.cancelRequested) await controller.cancelRun(active);
      return;
    }
    const session = state.session;
    const text = prompt.value.trim();
    const choice = parseChoice(account.value);
    if (submitting || session === undefined || text === "" || choice === undefined || !canRun(state)) return;
    submitting = true;
    refresh(state);
    const ok = await controller.startRun({
      sessionId: session.id,
      projectId: session.projectId,
      workspaceId: session.workspaceId,
      runtimeId: runtime.value ?? "",
      providerId: choice.providerId,
      ...(choice.accountId === undefined ? {} : { accountId: choice.accountId }),
      ...(model === "" ? {} : { model }),
      prompt: text,
      permissionMode: mode,
    });
    submitting = false;
    if (ok) {
      prompt.value = "";
      autoGrow();
    }
    refresh(store.get());
  }

  /** Latest run of the session if it ended `unknown` and was not acknowledged. */
  function unacknowledgedUnknown(state: AppState): string | undefined {
    const last = state.runs.at(-1);
    return last?.status === "unknown" && state.acknowledgedUnknown[last.id] === undefined ? last.id : undefined;
  }

  function canRun(state: AppState): boolean {
    return state.session !== undefined &&
      state.host.status === "ready" &&
      runtime.value !== undefined &&
      account.value !== undefined &&
      unacknowledgedUnknown(state) === undefined &&
      !modeDisabled(capabilitiesFor(state));
  }

  function effectiveAccount(state: AppState): AccountView | undefined {
    const choice = parseChoice(account.value);
    if (choice === undefined) return undefined;
    return choice.accountId === undefined
      ? state.accounts.find((entry) => entry.providerId === choice.providerId && entry.selected)
      : state.accounts.find((entry) => entry.id === choice.accountId);
  }

  function capabilitiesFor(state: AppState): RuntimeCapabilities | undefined {
    const target = effectiveAccount(state);
    if (runtime.value === undefined || target === undefined) return undefined;
    const key = `${runtime.value}|${target.id}`;
    const caps = state.capabilities[key];
    if (caps === undefined) void controller.loadCapabilities(runtime.value, target.id);
    return caps;
  }

  function modeDisabled(caps: RuntimeCapabilities | undefined): boolean {
    return caps !== undefined && !caps.approvals && needsApprovals(mode);
  }

  function refresh(state: AppState): void {
    // Runtime menu: capability flags for the effective account, when known.
    const target = effectiveAccount(state);
    runtime.setOptions(state.runtimes.map((entry) => {
      const caps = target === undefined ? undefined : state.capabilities[`${entry.runtimeId}|${target.id}`];
      return {
        value: entry.runtimeId,
        label: entry.runtimeId,
        icon: "cpu",
        description: caps === undefined
          ? "Choose an account to see capabilities"
          : CAPABILITY_LABELS.filter(([key]) => caps[key]).map(([, text]) => text).join(", ") || "No optional capabilities",
      };
    }), runtime.value ?? state.runtimes[0]?.runtimeId);

    // Account menu: grouped by provider, each with an Auto entry first.
    const providers = [...new Set(state.accounts.map((entry) => entry.providerId))].sort();
    const accountOptions: DropdownOption<AccountChoice>[] = providers.flatMap((providerId) => {
      const accounts = state.accounts.filter((entry) => entry.providerId === providerId);
      const selected = accounts.find((entry) => entry.selected);
      return [
        {
          value: `auto:${providerId}` as const,
          label: `Auto`,
          description: selected === undefined
            ? "No selected account; the host picks an available one"
            : `Selected: ${accountLabel(selected)}, with fallback if unavailable`,
          icon: "sliders-horizontal" as const,
          group: providerId,
        },
        ...accounts.map((entry): DropdownOption<AccountChoice> => ({
          value: `account:${providerId}:${entry.id}`,
          label: accountLabel(entry),
          description: entry.availability.replace("_", " "),
          icon: "user-circle",
          group: providerId,
        })),
      ];
    });
    account.element.hidden = accountOptions.length === 0;
    connectPill.hidden = accountOptions.length > 0;
    const firstProvider = providers[0];
    account.setOptions(accountOptions, account.value ?? (firstProvider === undefined ? undefined : `auto:${firstProvider}`));

    // Permission menu: descriptions carry the app meaning and native mapping.
    const caps = capabilitiesFor(state);
    const runtimeView = state.runtimes.find((entry) => entry.runtimeId === runtime.value);
    permission.setOptions(PERMISSION_MODES.map((candidate) => {
      const unavailable = caps !== undefined && !caps.approvals && needsApprovals(candidate);
      return {
        value: candidate,
        label: PERMISSION_LABELS[candidate].label,
        icon: MODE_ICONS[candidate],
        disabled: unavailable,
        description: unavailable
          ? "This runtime does not support interactive approvals."
          : `${PERMISSION_LABELS[candidate].note}${runtimeView === undefined ? "" : ` Native: ${runtimeView.permissionMappings[candidate]}`}`,
      };
    }), mode);

    replace(modelButton.querySelector(".dropdown-value") as HTMLElement, model === "" ? "Default model" : model);

    const unknownRunId = unacknowledgedUnknown(state);
    replace(guard, ...(unknownRunId === undefined ? [] : [
      icon("warning-circle"),
      h("span", {}, "The last run ended with an unknown outcome. Review its details before continuing; nothing is replayed automatically."),
      h("button", { class: "button button-small", type: "button", onClick: () => controller.acknowledgeUnknown(unknownRunId) }, "I reviewed it"),
    ]));
    guard.hidden = unknownRunId === undefined;

    const noSession = state.session === undefined || state.host.status !== "ready";
    prompt.disabled = noSession;
    prompt.placeholder = state.session === undefined ? "Open or start a session to run an agent" : "Ask the agent to do something";
    for (const control of [permission, runtime, account]) control.setDisabled(noSession);
    modelButton.disabled = noSession;

    const active = activeRunId(state);
    if (active !== undefined) {
      const cancelling = state.live[active]?.cancelRequested === true;
      replace(send, icon("stop"));
      send.classList.add("is-stop");
      send.disabled = cancelling;
      send.title = cancelling ? "Cancelling" : "Stop the running agent";
      send.setAttribute("aria-label", send.title);
    } else {
      replace(send, submitting ? icon("circle-notch", { className: "spin" }) : icon("arrow-up"));
      send.classList.remove("is-stop");
      send.disabled = submitting || prompt.value.trim() === "" || !canRun(state);
      send.title = "Run (Enter)";
      send.setAttribute("aria-label", "Run");
    }
  }

  store.watch(
    (state) => [state.runtimes, state.accounts, state.capabilities, state.session, state.runs, state.acknowledgedUnknown, state.host, activeKey(state)],
    (_slice, state) => refresh(state),
  );
}

function needsApprovals(mode: PermissionMode): boolean {
  return mode === "ask" || mode === "approve_for_me";
}

function parseChoice(value: AccountChoice | undefined): { providerId: string; accountId?: string } | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("auto:")) return { providerId: value.slice("auto:".length) };
  const [, providerId, accountId] = value.split(":");
  return providerId === undefined || accountId === undefined ? undefined : { providerId, accountId };
}

/** Changes only when the set of active runs or their cancel state changes. */
function activeKey(state: AppState): string {
  return Object.values(state.live).map((live) => `${live.run.id}:${live.run.status}:${live.cancelRequested}`).join("|");
}
