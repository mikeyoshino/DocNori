// Shared, non-blocking busy indicator. Overlapping operations share one spinner.
export function beginActivity() {
  let indicator = document.querySelector<HTMLElement>("[data-app-activity]");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "app-activity";
    indicator.dataset.appActivity = "0";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-label", "กำลังโหลด");
    indicator.innerHTML = '<span aria-hidden="true"></span>';
    document.body.append(indicator);
  }
  indicator.dataset.appActivity = String(
    Number(indicator.dataset.appActivity) + 1,
  );
  indicator.hidden = false;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const pending = Math.max(0, Number(indicator.dataset.appActivity) - 1);
    indicator.dataset.appActivity = String(pending);
    if (!pending) indicator.hidden = true;
  };
}
export async function withActivity<T>(action: () => Promise<T>): Promise<T> {
  const finish = beginActivity();
  try {
    return await action();
  } finally {
    finish();
  }
}
