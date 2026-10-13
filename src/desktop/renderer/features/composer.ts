/**
 * Run composer. Provider runtimes are implementation details: the only
 * provider-facing choice is a model from the unified catalog. The selected
 * model carries hidden runtime/provider routing metadata to the host.
 *
 * Pending approvals are rendered above the prompt so they remain actionable
 * without becoming chat messages. The host owns the pending state, which
 * means a reconnecting renderer can answer an approval just like the original.
 */
import {
  PERMISSION_MODES,
  type AccountView,
  type ApprovalRequest,
  type ModelView,
  type PermissionMode,
  type RunView,
  type RuntimeCapabilities,
} from "../../../contracts/desktop/index.js";
import { createDropdown, type DropdownOption } from "../components/dropdown.js";
import type { Controller } from "../controller.js";
import { dataView, h, replace, row, shortId } from "../dom.js";
import { icon } from "../icons.js";
import type { AppState, LiveRun, Store } from "../store.js";
import { accountLabel, isActiveStatus, PERMISSION_LABELS } from "./run-format.js";

type AccountChoice = `auto:${string}` | `account:${string}:${string}`;
type ModelChoice = string;

const MODE_ICONS: Readonly<Record<PermissionMode, Parameters<typeof icon>[0]>> = {
  read_only: "lock-simple", ask: "hand", approve_for_me: "shield-check", full_access: "lightning",
};

export function mountComposer(root: HTMLElement, store: Store, controller: Controller): void {
  let mode: PermissionMode = "ask";
  let submitting = false;

  const permission = createDropdown<PermissionMode>({
    ariaLabel: "Permission mode", variant: "pill", icon: "shield", menuWidth: 340,
    onChange: (value) => { mode = value; refresh(store.get()); },
  });
  const account = createDropdown<AccountChoice>({
    ariaLabel: "Account", variant: "pill", icon: "user", placeholder: "No accounts", menuWidth: 280,
    formatValue: (option) => option.label.toLowerCase() === "auto" ? "Auto" : option.label,
    onChange: () => refresh(store.get()),
  });
  const model = createDropdown<ModelChoice>({
    ariaLabel: "Model", variant: "pill", icon: "robot", placeholder: "Choose a model", menuWidth: 340,
    onChange: () => refresh(store.get()),
  });

  const connectPill = h("button", {
    class: "dropdown dropdown-pill", type: "button",
    onClick: () => controller.openSettings("accounts"),
  }, icon("plugs", { className: "dropdown-icon" }), h("span", { class: "dropdown-value" }, "Connect an account"));

  const prompt = h("textarea", {
    class: "prompt-input", rows: 1, placeholder: "Ask the agent to do something", aria: { label: "Prompt" },
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
        h("div", { class: "composer-pills" }, permission.element, account.element, connectPill, model.element),
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
  prompt.addEventListener("input", () => { autoGrow(); refresh(store.get()); });

  function autoGrow(): void {
    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(prompt.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  function activeRunId(state: AppState): string | undefined {
    return Object.values(state.live).find((live) => live.run.sessionId === state.session?.id && isActiveStatus(live.run.status))?.run.id;
  }

  async function submitOrStop(): Promise<void> {
    const state = store.get();
    const active = activeRunId(state);
    if (active !== undefined) {
      if (!state.live[active]?.cancelRequested) await controller.cancelRun(active);
      return;
    }
    const session = state.session;
    const selected = parseModelChoice(model.value, state.models);
    const choice = parseChoice(account.value);
    const text = prompt.value.trim();
    if (submitting || session === undefined || selected === undefined || choice === undefined || text === "" || !canRun(state)) return;
    submitting = true;
    refresh(state);
    const ok = await controller.startRun({
      sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId,
      runtimeId: selected.runtimeId, providerId: selected.providerId,
      ...(choice.accountId === undefined ? {} : { accountId: choice.accountId }),
      ...(selected.modelId === "default" ? {} : { model: selected.modelId }),
      prompt: text, permissionMode: mode,
    });
    submitting = false;
    if (ok) { prompt.value = ""; autoGrow(); }
    refresh(store.get());
  }

  function unacknowledgedUnknown(state: AppState): string | undefined {
    const last = state.runs.at(-1);
    return last?.status === "unknown" && state.acknowledgedUnknown[last.id] === undefined ? last.id : undefined;
  }

  function canRun(state: AppState): boolean {
    return state.session !== undefined && state.host.status === "ready" && model.value !== undefined &&
      account.value !== undefined && unacknowledgedUnknown(state) === undefined && !modeDisabled(capabilitiesFor(state));
  }

  function selectedModel(state: AppState): ModelView | undefined {
    return parseModelChoice(model.value, state.models)?.entry;
  }

  function effectiveAccount(state: AppState): AccountView | undefined {
    const selected = selectedModel(state);
    const choice = parseChoice(account.value);
    if (selected === undefined || choice === undefined) return undefined;
    return choice.accountId === undefined
      ? state.accounts.find((entry) => entry.providerId === selected.providerId && entry.selected)
      : state.accounts.find((entry) => entry.id === choice.accountId && entry.providerId === selected.providerId);
  }

  function capabilitiesFor(state: AppState): RuntimeCapabilities | undefined {
    const selected = selectedModel(state);
    const target = effectiveAccount(state);
    if (selected === undefined || target === undefined) return undefined;
    const key = `${selected.runtimeId}|${target.id}`;
    const caps = state.capabilities[key];
    if (caps === undefined) void controller.loadCapabilities(selected.runtimeId, target.id);
    return caps;
  }

  function modeDisabled(caps: RuntimeCapabilities | undefined): boolean {
    return caps !== undefined && !caps.approvals && (mode === "ask" || mode === "approve_for_me");
  }

  function refresh(state: AppState): void {
    const modelOptions: DropdownOption<ModelChoice>[] = state.models.map((entry) => ({
      value: modelKey(entry), label: entry.label,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      group: entry.providerName, icon: entry.providerId === "claude" ? "lightbulb" : "robot",
    }));
    const first = state.models.find((entry) => entry.isDefault) ?? state.models[0];
    model.setOptions(modelOptions, model.value ?? (first === undefined ? undefined : modelKey(first)));

    const selected = selectedModel(state);
    const targetProvider = selected?.providerId;
    const accounts = targetProvider === undefined ? [] : state.accounts.filter((entry) => entry.providerId === targetProvider);
    const accountOptions: DropdownOption<AccountChoice>[] = targetProvider === undefined || accounts.length === 0 ? [] : [
      {
        value: `auto:${targetProvider}` as AccountChoice, label: "Auto",
        description: accounts.find((entry) => entry.selected) === undefined
          ? "The host chooses an available account"
          : `Selected: ${accountLabel(accounts.find((entry) => entry.selected))}, with fallback if unavailable`,
        icon: "sliders-horizontal", group: selected?.providerName ?? "",
      },
      ...accounts.map((entry): DropdownOption<AccountChoice> => ({
        value: `account:${targetProvider}:${entry.id}`, label: accountLabel(entry),
        description: entry.availability.replace("_", " "), icon: "user-circle", group: selected?.providerName ?? "",
      })),
    ];
    account.element.hidden = accountOptions.length === 0;
    connectPill.hidden = accountOptions.length > 0;
    const currentAccount = account.value;
    const accountStillValid = currentAccount !== undefined && accountOptions.some((option) => option.value === currentAccount);
    account.setOptions(accountOptions, accountStillValid ? currentAccount : (targetProvider === undefined ? undefined : `auto:${targetProvider}`));

    const caps = capabilitiesFor(state);
    const runtimeView = selected === undefined ? undefined : state.runtimes.find((entry) => entry.runtimeId === selected.runtimeId);
    permission.setOptions(PERMISSION_MODES.map((candidate) => {
      const unavailable = caps !== undefined && !caps.approvals && (candidate === "ask" || candidate === "approve_for_me");
      return {
        value: candidate, label: PERMISSION_LABELS[candidate].label, icon: MODE_ICONS[candidate], disabled: unavailable,
        description: unavailable ? "This runtime does not support interactive approvals." :
          `${PERMISSION_LABELS[candidate].note}${runtimeView === undefined ? "" : ` Native: ${runtimeView.permissionMappings[candidate]}`}`,
      };
    }), mode);

    const unknownRunId = unacknowledgedUnknown(state);
    const approvals = pendingApprovals(state);
    const catalogMessage = modelCatalogMessage(state);
    replace(guard,
      ...approvals.map(({ run, live, request }) => renderApproval(request, run, live, state, controller)),
      ...(catalogMessage === undefined ? [] : [
        h("div", { class: "guard-warning catalog-warning" }, icon("info"), h("span", {}, catalogMessage)),
      ]),
      ...(unknownRunId === undefined ? [] : [
        h("div", { class: "guard-warning" }, icon("warning-circle"),
          h("span", {}, "The last run ended with an unknown outcome. Review its details before continuing; nothing is replayed automatically."),
          h("button", { class: "button button-small", type: "button", onClick: () => controller.acknowledgeUnknown(unknownRunId) }, "I reviewed it")),
      ]),
    );
    guard.hidden = approvals.length === 0 && catalogMessage === undefined && unknownRunId === undefined;
    guard.classList.toggle("approval-open", approvals.length > 0);

    const noSession = state.session === undefined || state.host.status !== "ready";
    prompt.disabled = noSession;
    prompt.placeholder = state.session === undefined ? "Open or start a session to run an agent" : "Ask the agent to do something";
    permission.setDisabled(noSession);
    account.setDisabled(noSession);
    model.setDisabled(noSession || modelOptions.length === 0);

    const active = activeRunId(state);
    if (active !== undefined) {
      const cancelling = state.live[active]?.cancelRequested === true;
      replace(send, icon("stop"));
      send.classList.add("is-stop"); send.disabled = cancelling; send.title = cancelling ? "Cancelling" : "Stop the running agent";
      send.setAttribute("aria-label", send.title);
    } else {
      replace(send, submitting ? icon("circle-notch", { className: "spin" }) : icon("arrow-up"));
      send.classList.remove("is-stop"); send.disabled = submitting || prompt.value.trim() === "" || !canRun(state);
      send.title = "Run (Enter)"; send.setAttribute("aria-label", "Run");
    }
  }

  store.watch(
    (state) => [state.models, state.modelCatalogFailures, state.runtimes, state.accounts, state.capabilities, state.session, state.runs, state.live, state.acknowledgedUnknown, state.host, activeKey(state)],
    (_slice, state) => refresh(state),
  );
}

function modelCatalogMessage(state: AppState): string | undefined {
  if (state.models.length > 0 && state.modelCatalogFailures.length === 0) return undefined;
  if (state.models.length === 0 && state.modelCatalogFailures.length === 0) {
    return "Connect a provider account to load its available models.";
  }
  if (state.models.length === 0) {
    return "No models are available. Check the connected provider accounts and try again.";
  }
  const count = state.modelCatalogFailures.length;
  return `${count} connected account${count === 1 ? "" : "s"} could not load its model list. Showing the models that were found.`;
}

function pendingApprovals(state: AppState): readonly { readonly run: RunView; readonly live: LiveRun; readonly request: ApprovalRequest }[] {
  if (state.session === undefined) return [];
  return Object.values(state.live)
    .filter((live) => live.run.sessionId === state.session?.id)
    .flatMap((live) => live.pendingApprovals.map((request) => ({ run: live.run, live, request })));
}

function renderApproval(request: ApprovalRequest, run: RunView, _live: LiveRun, state: AppState, controller: Controller): HTMLElement {
  const account = state.accounts.find((candidate) => candidate.id === run.accountId);
  return h("div", { class: "approval approval-overlay-card" },
    h("div", { class: "approval-head" },
      h("span", { class: "icon-tile" }, icon("hand")),
      h("span", { class: "tool-text" }, h("span", { class: "tool-name" }, "Approval required"),
        h("span", { class: "tool-meta" }, `${request.tool} / ${shortId(request.id)}`))),
    request.reason === undefined ? null : h("p", { class: "approval-reason" }, request.reason),
    h("div", { class: "detail-rows" }, row("Account", accountLabel(account, run.accountId)), row("Model", run.model ?? "default"), row("Run / attempt", `${shortId(run.id)} / ${shortId(run.attempts.at(-1)?.id)}`)),
    dataView("Input", request.input),
    h("div", { class: "approval-actions" },
      h("button", { class: "button", onClick: () => void controller.respondToApproval(run.id, request.id, "deny") }, icon("x"), "Deny"),
      h("button", { class: "button button-primary", onClick: () => void controller.respondToApproval(run.id, request.id, "allow") }, icon("check"), "Allow")),
  );
}

function modelKey(model: ModelView): ModelChoice {
  return `${model.providerId}|${model.runtimeId}|${model.id}`;
}

function parseModelChoice(value: ModelChoice | undefined, models: readonly ModelView[]): { readonly entry: ModelView; readonly providerId: string; readonly runtimeId: string; readonly modelId: string } | undefined {
  if (value === undefined) return undefined;
  const entry = models.find((candidate) => modelKey(candidate) === value);
  if (entry === undefined) return undefined;
  return { entry, providerId: entry.providerId, runtimeId: entry.runtimeId, modelId: entry.id };
}

function parseChoice(value: AccountChoice | undefined): { providerId: string; accountId?: string } | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("auto:")) return { providerId: value.slice("auto:".length) };
  const [, providerId, accountId] = value.split(":");
  return providerId === undefined || accountId === undefined ? undefined : { providerId, accountId };
}

function activeKey(state: AppState): string {
  return Object.values(state.live).map((live) => `${live.run.id}:${live.run.status}:${live.cancelRequested}:${live.pendingApprovals.length}`).join("|");
}
