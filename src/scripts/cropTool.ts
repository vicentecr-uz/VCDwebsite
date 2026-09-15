import type { CropRect } from "../lib/cropBounds";
import { addPadding } from "../lib/cropBounds";
// Limit decoded images to 24 MP / 8192px per side; use tiled decoding for larger sources.
const MAX_PIXELS = 24_000_000;
const MAX_SIDE = 8192;
type State = {
  image: HTMLImageElement;
  width: number;
  height: number;
  rect: CropRect;
  base: CropRect;
};
const q = <T extends Element>(r: ParentNode, s: string) =>
  r.querySelector<T>(s)!;
export function bindCropTool(root: HTMLElement) {
  const input = q<HTMLInputElement>(root, "[data-file]"),
    drop = q<HTMLElement>(root, "[data-drop]"),
    thumb = q<HTMLImageElement>(root, "[data-thumb]"),
    progress = q<HTMLElement>(root, "[data-progress]"),
    stage = q<HTMLElement>(root, "[data-stage]"),
    original = q<HTMLImageElement>(root, "[data-original]"),
    selected = q<HTMLImageElement>(root, "[data-selected]"),
    frame = q<HTMLElement>(root, "[data-frame]"),
    status = q<HTMLElement>(root, "[data-status]"),
    padding = q<HTMLInputElement>(root, "[data-padding]"),
    output = q<HTMLOutputElement>(root, "output"),
    download = q<HTMLButtonElement>(root, "[data-download]"),
    reset = q<HTMLButtonElement>(root, "[data-reset]");
  let current: State | null = null,
    worker: Worker | null = null,
    url = "",
    generation = 0;
  const setProgress = (v: number) => {
    progress.style.width = `${v * 100}%`;
    progress.parentElement!.setAttribute(
      "aria-valuenow",
      String(Math.round(v * 100)),
    );
  };
  const render = () => {
    if (!current) return;
    const r = current.rect,
      w = current.width,
      h = current.height,
      l = (r.left / w) * 100,
      t = (r.top / h) * 100,
      cw = ((r.right - r.left + 1) / w) * 100,
      ch = ((r.bottom - r.top + 1) / h) * 100;
    frame.style.cssText = `left:${l}%;top:${t}%;width:${cw}%;height:${ch}%`;
    selected.style.clipPath = `inset(${t}% ${100 - l - cw}% ${100 - t - ch}% ${l}%)`;
  };
  const show = () => {
    stage.hidden = false;
    download.disabled = false;
    reset.disabled = false;
    render();
  };
  const error = (m: string) => {
    worker?.terminate();
    worker = null;
    current = null;
    download.disabled = reset.disabled = true;
    setProgress(0);
    status.textContent = m;
    status.dataset.state = "error";
    stage.hidden = true;
  };
  const process = async (file: File) => {
    const id = ++generation;
    worker?.terminate();
    worker = null;
    current = null;
    stage.hidden = true;
    download.disabled = reset.disabled = true;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);
    setProgress(0.03);
    status.textContent = "Reading image";
    delete status.dataset.state;
    thumb.removeAttribute("src");
    if (
      !/^image\/(png|jpeg|jpg)$/.test(file.type) ||
      file.size > 50 * 1024 * 1024
    )
      return error(
        file.size > 50 * 1024 * 1024
          ? "Image must be 50 MB or smaller"
          : "Choose a PNG or JPEG image",
      );
    try {
      const bitmap = await createImageBitmap(file);
      if (id !== generation) {
        bitmap.close();
        return;
      }
      if (
        bitmap.width > MAX_SIDE ||
        bitmap.height > MAX_SIDE ||
        bitmap.width * bitmap.height > MAX_PIXELS
      ) {
        bitmap.close();
        return error(
          "Image is too large (maximum 24 megapixels and 8192px per side)",
        );
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setProgress(0.18);
      thumb.src = original.src = selected.src = url;
      await original.decode();
      if (id !== generation) return;
      stage.style.aspectRatio = `${canvas.width}/${canvas.height}`;
      const full = {
        left: 0,
        top: 0,
        right: canvas.width - 1,
        bottom: canvas.height - 1,
      };
      const next: State = {
        image: original,
        width: canvas.width,
        height: canvas.height,
        rect: full,
        base: full,
      };
      current = next;
      worker = new Worker(new URL("./crop.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e) => {
        if (id !== generation) return;
        if (e.data.type === "progress") setProgress(0.2 + e.data.value * 0.7);
        if (e.data.result) {
          next.base = e.data.result.bounds;
          next.rect = addPadding(
            next.base,
            next.width,
            next.height,
            +padding.value,
          );
          status.textContent =
            e.data.result.mode === "full"
              ? "Could not find a confident background"
              : "Crop ready";
          show();
          worker?.terminate();
          worker = null;
          setProgress(1);
        }
      };
      worker.onerror = () => {
        if (id === generation) error("Could not process this image");
      };
      worker.postMessage(
        { data: pixels.data, width: canvas.width, height: canvas.height },
        [pixels.data.buffer],
      );
    } catch {
      if (id === generation) error("Could not read this image");
    }
  };
  const move = (edge: string, dx: number, dy: number) => {
    if (!current) return;
    const r = current.rect;
    if (edge.includes("w"))
      r.left = Math.max(0, Math.min(r.right, r.left + dx));
    if (edge.includes("e"))
      r.right = Math.min(current.width - 1, Math.max(r.left, r.right + dx));
    if (edge.includes("n")) r.top = Math.max(0, Math.min(r.bottom, r.top + dy));
    if (edge.includes("s"))
      r.bottom = Math.min(current.height - 1, Math.max(r.top, r.bottom + dy));
    render();
  };
  root.querySelectorAll<HTMLElement>("[data-handle]").forEach((handle) => {
    handle.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
        return;
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      move(
        handle.dataset.handle!,
        e.key === "ArrowLeft" ? -s : e.key === "ArrowRight" ? s : 0,
        e.key === "ArrowUp" ? -s : e.key === "ArrowDown" ? s : 0,
      );
    });
    let start: { x: number; y: number; rect: CropRect } | null = null;
    handle.addEventListener("pointerdown", (e) => {
      if (!current || e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, rect: { ...current.rect } };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!start || !current) return;
      const b = stage.getBoundingClientRect();
      current.rect = { ...start.rect };
      move(
        handle.dataset.handle!,
        Math.round(((e.clientX - start.x) * current.width) / b.width),
        Math.round(((e.clientY - start.y) * current.height) / b.height),
      );
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) =>
      handle.addEventListener(t, () => {
        start = null;
      }),
    );
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) void process(file);
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.dataset.dragging = "true";
  });
  drop.addEventListener("dragleave", () => {
    delete drop.dataset.dragging;
  });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    delete drop.dataset.dragging;
    const f = e.dataTransfer?.files[0];
    if (f) void process(f);
  });
  padding.addEventListener("input", () => {
    output.value = `${padding.value}%`;
    if (current) {
      current.rect = addPadding(
        current.base,
        current.width,
        current.height,
        +padding.value,
      );
      render();
    }
  });
  reset.addEventListener("click", () => {
    if (current) {
      current.rect = addPadding(
        current.base,
        current.width,
        current.height,
        +padding.value,
      );
      render();
    }
  });
  download.addEventListener("click", async () => {
    if (!current) return;
    try {
      const c = document.createElement("canvas"),
        w = current.rect.right - current.rect.left + 1,
        h = current.rect.bottom - current.rect.top + 1;
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(
        current.image,
        current.rect.left,
        current.rect.top,
        w,
        h,
        0,
        0,
        w,
        h,
      );
      const blob = await new Promise<Blob | null>((r) =>
        c.toBlob(r, "image/png"),
      );
      if (!blob) throw Error();
      const a = document.createElement("a");
      a.download = "cropped-image.png";
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      status.textContent = "Could not export this image";
    }
  });
}
