import { mount as mountFixed } from "./fixed-mask.js";
import { mount as mountMoving } from "./moving-mask.js";
import { createPageScope, onPageLoad } from "../../lib/pageLifecycle";

const PICKER_CSS = `.proto-picker{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:rgba(10,10,10,.82);-webkit-backdrop-filter:blur(12px) saturate(1.4);backdrop-filter:blur(12px) saturate(1.4);box-shadow:0 0 0 1px rgba(255,255,255,.08) inset,0 8px 24px rgba(0,0,0,.24),0 2px 6px rgba(0,0,0,.12);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}.proto-picker-highlight{position:absolute;top:4px;left:0;height:28px;border-radius:999px;background:rgba(255,255,255,.12);will-change:transform}.proto-picker[data-ready] .proto-picker-highlight{transition:transform 250ms cubic-bezier(.23,1,.32,1),width 250ms cubic-bezier(.23,1,.32,1)}@media (prefers-reduced-motion:reduce){.proto-picker[data-ready] .proto-picker-highlight{transition:none}}.proto-picker-item{position:relative;display:flex;align-items:center;height:28px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:rgba(255,255,255,.55);font:inherit;cursor:pointer;transition:color 150ms ease-out}.proto-picker-item:hover{color:rgba(255,255,255,.85)}.proto-picker-item:active{transform:scale(.97)}.proto-picker-item:focus-visible{outline:2px solid rgba(255,255,255,.4);outline-offset:2px}.proto-picker-item[data-active]{color:#fff}.proto-picker-divider{width:1px;height:16px;margin:0 4px;background:rgba(255,255,255,.12)}.proto-picker-replay{padding:0 10px;font-size:14px}.proto-picker[data-position="top"]{bottom:auto;top:24px}`;
const PICKER_MARKUP =
  '<span class="proto-picker-highlight" aria-hidden="true"></span><button class="proto-picker-item" data-active aria-current="true">Fixed mask</button><button class="proto-picker-item">Moving mask</button><span class="proto-picker-divider" aria-hidden="true"></span><button class="proto-picker-item proto-picker-replay" aria-label="Replay animation (R)">↻</button>';
const variants = [mountFixed, mountMoving];

const disposePage = onPageLoad(() => {
  const scope = createPageScope();
  const style = document.createElement("style");
  style.textContent = PICKER_CSS;
  document.head.append(style);
  const picker = document.createElement("nav");
  picker.className = "proto-picker";
  picker.setAttribute("aria-label", "Prototype variants");
  picker.innerHTML = PICKER_MARKUP;
  document.body.append(picker);

  const highlight = picker.querySelector(".proto-picker-highlight");
  const items = [
    ...picker.querySelectorAll(".proto-picker-item:not(.proto-picker-replay)"),
  ];
  const replay = picker.querySelector(".proto-picker-replay");
  const panels = [
    ...document.querySelectorAll("[data-dev-overlay]:not([data-embedded])"),
  ];
  let current = 0;
  let disposeVariant = () => {};
  let lastPanel = null;
  let replayGeneration = 0;

  const visiblePanels = () =>
    panels.filter(
      (panel) =>
        !panel.hidden && panel.classList.contains("is-dev-overlay-open"),
    );
  const updateReplay = () => {
    replay.disabled = !visiblePanels().some((panel) =>
      panel.querySelector("[data-minimize-toggle]"),
    );
  };
  const moveHighlight = () => {
    const item = items[current];
    highlight.style.width = `${item.offsetWidth}px`;
    highlight.style.transform = `translateX(${item.offsetLeft}px)`;
  };
  const setActive = (index) => {
    if (index < 0 || index >= variants.length) return;
    replayGeneration += 1;
    disposeVariant();
    current = index;
    items.forEach((item, itemIndex) => {
      item.toggleAttribute("data-active", itemIndex === current);
      if (itemIndex === current) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
    moveHighlight();
    const url = new URL(location.href);
    url.searchParams.set("v", String(current + 1));
    history.replaceState(null, "", url);
    disposeVariant = variants[current](panels);
  };
  const replayCurrent = () => {
    const panel =
      lastPanel && visiblePanels().includes(lastPanel)
        ? lastPanel
        : visiblePanels()[0];
    const button = panel?.querySelector("[data-minimize-toggle]");
    if (!button || replay.disabled) return;
    const generation = ++replayGeneration;
    if (panel.classList.contains("is-minimized")) {
      button.click();
      return;
    }
    button.click();
    const source = panel
      .getAnimations()
      .find((animation) =>
        (animation.effect?.getKeyframes?.() ?? []).some(
          (frame) => frame.height != null,
        ),
      );
    if (!source) return;
    source.finished
      .then(() => {
        if (
          generation !== replayGeneration ||
          !panel.isConnected ||
          !visiblePanels().includes(panel)
        )
          return;
        if (panel.classList.contains("is-minimized"))
          panel.querySelector("[data-minimize-toggle]")?.click();
      })
      .catch(() => {});
  };

  panels.forEach((panel) => {
    const observer = new MutationObserver(updateReplay);
    observer.observe(panel, {
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    scope.add(() => observer.disconnect());
  });
  scope.listen(
    document,
    "pointerdown",
    (event) => {
      const panel = event.target.closest?.(
        "[data-dev-overlay]:not([data-embedded])",
      );
      if (!panel) return;
      lastPanel = panel;
      replayGeneration += 1;
    },
    true,
  );
  scope.listen(
    document,
    "focusin",
    (event) => {
      const panel = event.target.closest?.(
        "[data-dev-overlay]:not([data-embedded])",
      );
      if (panel) lastPanel = panel;
    },
    true,
  );
  scope.listen(document, "keydown", (event) => {
    const panel = event.target.closest?.(
      "[data-dev-overlay]:not([data-embedded])",
    );
    if (panel) replayGeneration += 1;
    if (
      event.defaultPrevented ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) ||
      event.target?.isContentEditable ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    const number = Number.parseInt(event.key, 10);
    if (number >= 1 && number <= variants.length) {
      event.preventDefault();
      setActive(number - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setActive((current + 1) % variants.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((current + variants.length - 1) % variants.length);
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      replayCurrent();
    }
  });
  items.forEach((item, index) =>
    scope.listen(item, "click", () => setActive(index)),
  );
  scope.listen(replay, "click", replayCurrent);
  scope.listen(window, "resize", moveHighlight);
  scope.frame(moveHighlight);
  scope.frame(() => picker.setAttribute("data-ready", ""));
  updateReplay();
  const requested = Number.parseInt(
    new URLSearchParams(location.search).get("v"),
    10,
  );
  setActive(requested === 2 ? 1 : 0);
  scope.add(() => {
    replayGeneration += 1;
    disposeVariant();
    picker.remove();
    style.remove();
  });
  return () => scope.destroy();
});

import.meta.hot?.dispose(disposePage);
