/**
 * Small centered dialog over a dimmed backdrop.
 *
 * Closes with the close button, Escape, or a click on the backdrop. While
 * open, Tab cycles within the dialog so keyboard focus cannot wander behind
 * it, and focus returns to the element that opened it when it closes.
 */
import { h } from "../dom.js";
import { icon } from "../icons.js";

export interface ModalHandle {
  close(): void;
}

export interface ModalOptions {
  readonly title: string;
  readonly content: HTMLElement;
  readonly onClose?: () => void;
}

export function openModal(options: ModalOptions): ModalHandle {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const dialog = h("div", { class: "modal", aria: { modal: "true", label: options.title } },
    h("div", { class: "modal-header" },
      h("h2", { class: "modal-title" }, options.title),
      h("button", { class: "icon-button", type: "button", title: "Close", aria: { label: "Close" }, onClick: () => handle.close() }, icon("x")),
    ),
    options.content,
  );
  dialog.setAttribute("role", "dialog");
  const backdrop = h("div", { class: "modal-backdrop" }, dialog);

  let closed = false;
  const handle: ModalHandle = {
    close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      previousFocus?.focus();
      options.onClose?.();
    },
  };

  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) handle.close();
  });
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      handle.close();
    } else if (event.key === "Tab") {
      trapFocus(dialog, event);
    }
  });

  document.body.append(backdrop);
  dialog.querySelector<HTMLElement>("input, button:not(.icon-button), select, textarea")?.focus();
  return handle;
}

function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  const focusable = [...container.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((element) => !element.hasAttribute("disabled"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
