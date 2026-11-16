# Dev canvas

On the dev server every page opens inside the canvas: a full-window shell (`src/pages/dev/canvas-shell.astro`) that runs the real page in a frame named `vcd-canvas`. It gives instant Desktop, Tablet and Mobile previews (⌥1, ⌥2, ⌥3), keeps Edit chrome outside the device frame, and holds what is centred while the page changes width. None of it exists in production; `scripts/production-boundary.mjs` and `scripts/check-production-output.mjs` enforce that.

## When it is on

`scripts/dev-canvas-shell.mjs` decides per request.

| This browser | Result |
| --- | --- |
| Opened `/dev/canvas/on` (`vcd-canvas=1`) | Canvas, always |
| Opened `/dev/canvas/off` (`vcd-canvas=0`) | Plain page, always |
| No choice made | Canvas, except on a phone or in an automated browser |

Both links take `?to=/page` to choose where to land, and the choice lasts a year in that browser.

With no choice made, the plain page is served when the request says it is a phone (`Sec-CH-UA-Mobile`, or a mobile user agent) or headless Chrome. The shell also steps aside by itself when it finds a screen no wider than 640px or `navigator.webdriver`, by setting the session cookie `vcd-canvas-skip=1` and reloading.

Edit chrome floats outside the frame unless the browser opened `/dev/canvas/chrome-off` (`vcd-canvas-chrome=0`); `/dev/canvas/chrome-on` restores it.

## Working with it

- **Automated checks** see the plain page by default. A check that is about the canvas must open `/dev/canvas/on?to=/page` first, then look inside the `vcd-canvas` frame.
- **Browser devtools** open on the shell. Choose the `vcd-canvas` frame as the console's context to inspect the page.
- **Suspect the canvas?** Open `/dev/canvas/off` and try again. If the problem is gone, it belongs to the canvas.
- **Lapse and Agentation** run in the page, so they cannot inspect Edit panels or the viewport bar while those float in the shell.

## Why it is on by default (2026-11-16)

It was built and reviewed behind opt-in links ([PR #254](https://github.com/vicentecr-uz/VCDwebsite/pull/254)). Once the owner had signed off every item, leaving it opt-in meant the reviewed behaviour was invisible until someone remembered a link. It became the default with three guards, each answering a named risk:

- **Other agents and scripts.** A check written for the plain page would land on the shell and either fail or read the wrong document. Automated browsers therefore keep the plain page unless they ask for the canvas.
- **Phones.** On a real phone the canvas only wraps the page in a frame. Phones keep the plain page.
- **Coverage.** Owner review concentrated on project pages. A page that misbehaves may be showing a canvas fault, so the off link stays and remembers the choice.

Accepted limits: the inspectors cannot reach floating Edit chrome until the canvas is one document, and Safari has not been checked.
