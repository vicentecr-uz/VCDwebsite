(() => {
  const finite = (value, ceiling = 1000) =>
    Number.isFinite(value) && Math.abs(value) <= ceiling;
  const codepoints = (text) => [...text.replace(/ /g, "\u00a0")];
  const progressiveDelay = (index, total) => {
    let delay = 0;
    for (let i = 0; i < index; i += 1)
      delay += 40 + (total > 1 ? (i / (total - 1)) * 50 : 0);
    return delay;
  };
  const validMetrics = (metrics) =>
    Boolean(
      metrics &&
      typeof metrics.font === "string" &&
      metrics.font.length > 0 &&
      metrics.font.length <= 500 &&
      typeof metrics.lineHeight === "string" &&
      metrics.lineHeight.length <= 500 &&
      ["letterSpacing", "fontKerning", "fontFeatureSettings"].every(
        (key) => typeof metrics[key] === "string" && metrics[key].length <= 500,
      ),
    );
  const validGeometry = (geometry, count) =>
    Boolean(
      geometry &&
      finite(geometry.width) &&
      geometry.width > 0 &&
      finite(geometry.height) &&
      geometry.height > 0 &&
      finite(geometry.left) &&
      finite(geometry.top) &&
      Array.isArray(geometry.offsets) &&
      geometry.offsets.length === count &&
      geometry.offsets.every((offset) => finite(offset)),
    );
  const visibleLayer = () =>
    document.querySelector('.header-trigger__wordmark[aria-hidden="false"]') ||
    document.querySelector(".header-trigger__wordmark--page");
  const stylesFor = (element) => {
    const style = getComputedStyle(element);
    return {
      font:
        style.font ||
        `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`,
      lineHeight: style.lineHeight || "normal",
      letterSpacing: style.letterSpacing || "",
      fontKerning: style.fontKerning || "auto",
      fontFeatureSettings: style.fontFeatureSettings || "normal",
      fontSize: style.fontSize,
    };
  };
  const geometryFor = (element, text) => {
    const style = stylesFor(element);
    const fontSize = parseFloat(style.fontSize);
    const rect = element.getBoundingClientRect();
    const stackRect =
      element
        .closest(".header-trigger__wordmark-stack")
        ?.getBoundingClientRect() || rect;
    const chars = [...element.querySelectorAll(".header-trigger__char")];
    const values = codepoints(text);
    if (
      !fontSize ||
      chars.length !== values.length ||
      !rect.width ||
      !rect.height
    )
      return null;
    const offsets = chars.map(
      (char) => (char.getBoundingClientRect().left - rect.left) / fontSize,
    );
    if (!offsets.every((offset) => finite(offset))) return null;
    return {
      left: (rect.left - stackRect.left) / fontSize,
      top: (rect.top - stackRect.top) / fontSize,
      width: rect.width / fontSize,
      height: rect.height / fontSize,
      offsets,
      metrics: {
        font: style.font,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        fontKerning: style.fontKerning,
        fontFeatureSettings: style.fontFeatureSettings,
      },
    };
  };
  const targetGeometry = (source, text) => {
    const style = stylesFor(source);
    const fontSize = parseFloat(style.fontSize);
    if (!fontSize) return null;
    const probe = document.createElement("span");
    Object.assign(probe.style, {
      position: "absolute",
      top: "-9999px",
      left: "0",
      visibility: "hidden",
      whiteSpace: "nowrap",
      font: style.font,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      fontKerning: style.fontKerning,
      fontFeatureSettings: style.fontFeatureSettings,
    });
    probe.textContent = text.replace(/ /g, "\u00a0");
    document.body.append(probe);
    const node = probe.firstChild;
    const origin = probe.getBoundingClientRect().left;
    const offsets = [];
    let unit = 0;
    for (const character of codepoints(text)) {
      const range = document.createRange();
      range.setStart(node, unit);
      range.setEnd(node, unit + character.length);
      offsets.push((range.getBoundingClientRect().left - origin) / fontSize);
      unit += character.length;
    }
    const rect = probe.getBoundingClientRect();
    probe.remove();
    return {
      left: 0,
      top: 0,
      width: rect.width / fontSize,
      height: rect.height / fontSize,
      offsets,
    };
  };
  const applyMetrics = (element, metrics) => {
    element.style.font = metrics.font;
    element.style.lineHeight = metrics.lineHeight;
    element.style.letterSpacing = metrics.letterSpacing;
    element.style.fontKerning = metrics.fontKerning;
    element.style.fontFeatureSettings = metrics.fontFeatureSettings;
  };
  const layer = (
    source,
    text,
    geometry,
    metrics,
    mode,
    startedAt,
    fixed,
    timings,
  ) => {
    const result = source.cloneNode(false);
    result.style.cssText = "";
    result.className = "header-navigation-title-layer";
    Object.assign(result.style, {
      position: "absolute",
      left: `${geometry.left}em`,
      top: `${geometry.top}em`,
      width: `${geometry.width}em`,
      height: `${geometry.height}em`,
    });
    applyMetrics(result, metrics);
    const template = source.querySelector(".header-trigger__char");
    if (!template) return result;
    codepoints(text).forEach((character, index) => {
      const char = template.cloneNode(false);
      char.style.cssText = "";
      char.className = "header-trigger__char header-navigation-title-char";
      char.textContent = character;
      Object.assign(char.style, {
        position: "absolute",
        left: `${geometry.offsets[index]}em`,
        top: "0",
        margin: "0",
        transition: "none",
        opacity: fixed ? "1" : "0",
        filter: fixed ? "blur(0)" : "blur(4px)",
        whiteSpace: "nowrap",
        animation: fixed
          ? "none"
          : `${mode === "out" ? "vcd-header-title-out" : "vcd-header-title-in"} ${timings?.[index]?.durationMs ?? (mode === "out" ? 150 : 250)}ms ease ${(timings?.[index]?.delayMs ?? (mode === "out" ? index * 30 : progressiveDelay(index, codepoints(text).length))) - (Date.now() - startedAt)}ms both`,
      });
      result.append(char);
    });
    return result;
  };
  const charTimings = (element, text, mode) =>
    codepoints(text).map((_, index) => {
      const char = element.querySelectorAll(".header-trigger__char")[index];
      const opacity = Number(getComputedStyle(char).opacity);
      const animation = char
        .getAnimations?.()
        .find((item) => item.transitionProperty === "opacity" && item.effect?.getTiming);
      if (animation) {
        const timing = animation.effect.getTiming();
        const durationMs =
          typeof timing.duration === "number"
            ? timing.duration
            : Number(timing.duration);
        const delayMs =
          typeof animation.currentTime === "number" &&
          Number.isFinite(animation.currentTime)
            ? Number(timing.delay || 0) - animation.currentTime
            : NaN;
        if (!finite(durationMs, 10000) || !finite(delayMs, 10000)) return null;
        return { durationMs, delayMs };
      }
      if (opacity === (mode === "out" ? 0 : 1)) return { durationMs: 0, delayMs: 0 };
      return {
        durationMs: mode === "out" ? 150 : 250,
        delayMs:
          mode === "out"
            ? index * 30
            : progressiveDelay(index, codepoints(text).length),
      };
    });
  const validTimings = (timings, count) =>
    timings === undefined ||
    (Array.isArray(timings) &&
      timings.length === count &&
      timings.every(
        (item) =>
          item &&
          finite(item.durationMs, 10000) &&
          item.durationMs >= 0 &&
          finite(item.delayMs, 10000),
      ));

  window.__vcdHeaderTitleBridge = (pending, outgoing = false) => {
    const source = visibleLayer();
    if (
      !source ||
      typeof pending?.title !== "string" ||
      typeof pending?.targetTitle !== "string" ||
      pending.targetTitle.length > 300
    )
      return null;
    let sourceText = pending.title.replace(/\s+/g, " ").trim();
    const targetText = pending.targetTitle.replace(/\s+/g, " ").trim();
    if (!sourceText || !targetText || sourceText.length > 300) return null;
    if (outgoing) {
      let outgoingSource = source;
      if (
        source.classList.contains("header-trigger__wordmark--home") &&
        sourceText === targetText
      ) {
        const partiallyFaded = [
          ...source.querySelectorAll(".header-trigger__char"),
        ].some(
          (char) =>
            Number(getComputedStyle(char).opacity) < 1 ||
            char
              .getAnimations?.()
              .some((item) => item.transitionProperty === "opacity"),
        );
        const page = source.parentElement?.querySelector(
          ".header-trigger__wordmark--page",
        );
        if (partiallyFaded && page && page.textContent?.trim() !== targetText) {
          outgoingSource = page;
          pending.title = page.textContent.trim();
          sourceText = pending.title.replace(/\s+/g, " ").trim();
        }
      }
      const outgoingText = pending.title.replace(/\s+/g, " ").trim();
      const fromGeometry = geometryFor(outgoingSource, outgoingText);
      const toGeometry =
        outgoingSource !== source || sourceText === targetText
          ? geometryFor(source, targetText)
          : targetGeometry(outgoingSource, targetText);
      if (
        !fromGeometry ||
        !toGeometry ||
        !validGeometry(fromGeometry, codepoints(sourceText).length) ||
        !validGeometry(toGeometry, codepoints(targetText).length)
      )
        return null;
      if (outgoingSource === source) {
        toGeometry.left = fromGeometry.left;
        toGeometry.top = fromGeometry.top;
      }
      pending.fromGeometry = fromGeometry;
      pending.toGeometry = toGeometry;
      pending.fontMetrics = fromGeometry.metrics;
      if (outgoingSource !== source) {
        pending.fromCharTimings = charTimings(outgoingSource, outgoingText, "out");
        pending.toCharTimings = charTimings(source, targetText, "in");
      }
      pending.startedAt = Date.now();
    }
    if (
      !Number.isFinite(pending.startedAt) ||
      Date.now() - pending.startedAt > 10000 ||
      Date.now() < pending.startedAt ||
      !validMetrics(pending.fontMetrics) ||
      !validGeometry(pending.fromGeometry, codepoints(sourceText).length) ||
      !validGeometry(pending.toGeometry, codepoints(targetText).length) ||
      !validTimings(pending.fromCharTimings, codepoints(sourceText).length) ||
      !validTimings(pending.toCharTimings, codepoints(targetText).length)
    )
      return null;
    const stack = source.closest(".header-trigger__wordmark-stack");
    if (!stack) return null;
    const previousVisibility = stack.style.visibility;
    stack.style.visibility = "hidden";
    const overlay = document.createElement("div");
    overlay.className = "header-navigation-title";
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      visibility: "visible",
    });
    applyMetrics(overlay, pending.fontMetrics);
    const fixed = sourceText === targetText;
    overlay.append(
      layer(
        source,
        sourceText,
        pending.fromGeometry,
        pending.fontMetrics,
        "out",
        pending.startedAt,
        fixed,
        pending.fromCharTimings,
      ),
    );
    if (!fixed)
      overlay.append(
        layer(
          source,
          targetText,
          pending.toGeometry,
          pending.fontMetrics,
          "in",
          pending.startedAt,
          false,
          pending.toCharTimings,
        ),
      );
    stack.append(overlay);
    const timingEnd = (timings, fallback) =>
      Array.isArray(timings)
        ? Math.max(0, ...timings.map((item) => item.durationMs + item.delayMs))
        : fallback;
    const endMs = Math.max(
      timingEnd(pending.fromCharTimings, (codepoints(sourceText).length - 1) * 30 + 150),
      timingEnd(pending.toCharTimings, progressiveDelay(codepoints(targetText).length - 1, codepoints(targetText).length) + 250),
    );
    const finishesAt =
      Date.now() +
      (fixed ? 0 : Math.max(0, endMs - (Date.now() - pending.startedAt)));
    return {
      cleanup: () => {
        stack.style.visibility = previousVisibility;
        overlay.remove();
      },
      finishesAt,
      remainingMs: Math.max(0, finishesAt - Date.now()),
    };
  };
})();
