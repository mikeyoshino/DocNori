/** Trackpad zoom is intercepted only inside the document workspace. */
export function installGestureZoom(
  workspace: HTMLElement,
  signal: AbortSignal,
  enabled: () => boolean,
  apply: (factor: number, x: number, y: number) => Promise<void>,
  report: (error: unknown) => void,
) {
  let factor = 1,
    x = 0,
    y = 0,
    frame = 0,
    rendering = false;
  let safariScale: number | null = null;
  function schedule() {
    if (frame || rendering || signal.aborted) return;
    frame = requestAnimationFrame(async () => {
      frame = 0;
      if (!enabled() || signal.aborted) {
        factor = 1;
        return;
      }
      const change = factor;
      factor = 1;
      rendering = true;
      try {
        await apply(change, x, y);
      } catch (error) {
        report(error);
      } finally {
        rendering = false;
        if (factor !== 1) schedule();
      }
    });
  }
  function queue(change: number, clientX: number, clientY: number) {
    if (!Number.isFinite(change) || change <= 0) return;
    factor = Math.min(80, Math.max(0.0125, factor * change));
    x = clientX;
    y = clientY;
    schedule();
  }
  workspace.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey || !enabled()) return;
      event.preventDefault();
      if (safariScale !== null) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? workspace.clientHeight
            : 1;
      queue(
        Math.exp(-Math.max(-500, Math.min(500, event.deltaY * unit)) * 0.005),
        event.clientX,
        event.clientY,
      );
    },
    { passive: false, signal },
  );
  // Safari emits GestureEvent instead of ctrl+wheel for trackpad pinches.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    workspace.addEventListener(
      type,
      (event) => {
        if (!enabled()) {
          safariScale = null;
          return;
        }
        event.preventDefault();
        const gesture = event as Event & {
          scale: number;
          clientX: number;
          clientY: number;
        };
        if (type === "gesturestart") safariScale = gesture.scale || 1;
        else if (type === "gestureend") safariScale = null;
        else if (safariScale !== null && gesture.scale > 0) {
          queue(gesture.scale / safariScale, gesture.clientX, gesture.clientY);
          safariScale = gesture.scale;
        }
      },
      { passive: false, signal },
    );
  }
  signal.addEventListener("abort", () => cancelAnimationFrame(frame), {
    once: true,
  });
  return () => {
    cancelAnimationFrame(frame);
    frame = 0;
    factor = 1;
    safariScale = null;
  };
}
