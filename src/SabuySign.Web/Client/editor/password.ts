/** Passwords live only in this modal and the short-lived decryption worker. */
export function unlockPdf(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = document.createElement("dialog");
    dialog.className = "leave-dialog pdf-password-dialog";
    dialog.setAttribute("aria-labelledby", "pdf-password-title");
    dialog.setAttribute(
      "aria-describedby",
      "pdf-password-description pdf-password-output",
    );
    dialog.innerHTML = `<h2 id="pdf-password-title">กรอกรหัสผ่านเพื่อเปิด PDF</h2><p id="pdf-password-description">ใช้รหัสผ่านของเอกสารนี้ รหัสจะไม่ถูกส่งหรือบันทึกบนเซิร์ฟเวอร์</p><form><label for="pdf-password-input">รหัสผ่านเอกสาร</label><div class="pdf-password-field"><input id="pdf-password-input" type="password" autocomplete="off" spellcheck="false" maxlength="1024" aria-describedby="pdf-password-error" autofocus><button type="button" data-toggle aria-label="แสดงรหัสผ่าน" aria-pressed="false">แสดง</button></div><p id="pdf-password-error" role="alert" hidden></p><p id="pdf-password-output" class="pdf-password-note">ไฟล์ที่ดาวน์โหลดหลังแก้ไขจะไม่มีรหัสผ่าน ไฟล์ต้นฉบับยังเหมือนเดิม</p><div class="leave-dialog-actions"><button type="submit" class="leave-dialog-stay">เปิดเอกสาร</button><button type="button" class="leave-dialog-exit" data-cancel>ยกเลิก</button></div></form>`;
    const input = dialog.querySelector("input")!;
    const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const error = dialog.querySelector<HTMLElement>("#pdf-password-error")!;
    const toggle = dialog.querySelector<HTMLButtonElement>("[data-toggle]")!;
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const stop = () => {
      worker?.terminate();
      worker = undefined;
      clearTimeout(timeout);
    };
    const finish = (result: Uint8Array | null) => {
      if (settled) return;
      settled = true;
      stop();
      input.value = "";
      signal.removeEventListener("abort", cancel);
      window.removeEventListener("pagehide", cancel);
      dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(result);
    };
    const cancel = () => finish(null);
    const failed = (code: string) => {
      stop();
      input.disabled = submit.disabled = toggle.disabled = false;
      submit.textContent = "เปิดเอกสาร";
      input.value = "";
      input.setAttribute("aria-invalid", "true");
      error.textContent =
        code === "PASSWORD"
          ? "รหัสผ่านไม่ถูกต้อง กรุณาลองอีกครั้ง"
          : code === "PERMISSION"
            ? "เอกสารนี้จำกัดการแก้ไข กรุณาใช้รหัสผ่านของเจ้าของเอกสาร"
            : code === "LIMIT"
              ? "ไฟล์หลังเปิดมีขนาดเกิน 25 MB กรุณาใช้ไฟล์ที่เล็กลง"
              : "เปิดเอกสารไม่สำเร็จ ไฟล์อาจใช้การป้องกันที่ยังไม่รองรับ กรุณาลองอีกครั้งหรือเลือกไฟล์อื่น";
      error.hidden = false;
      input.focus();
    };
    toggle.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.textContent = show ? "ซ่อน" : "แสดง";
      toggle.setAttribute("aria-label", show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
      toggle.setAttribute("aria-pressed", String(show));
    });
    dialog.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      if (worker || settled) return;
      error.hidden = true;
      input.removeAttribute("aria-invalid");
      input.disabled = submit.disabled = toggle.disabled = true;
      submit.textContent = "กำลังเปิด…";
      try {
        worker = new Worker("/js/decrypt.worker.js", { type: "module" });
        worker.onmessage = (e) => {
          if (e.data.bytes) finish(e.data.bytes);
          else failed(e.data.error);
        };
        worker.onerror = () => failed("UNSUPPORTED");
        timeout = setTimeout(() => failed("TIMEOUT"), 60000);
        worker.postMessage({ bytes, password: input.value });
        input.value = "";
      } catch {
        failed("UNSUPPORTED");
      }
    });
    dialog.querySelector("[data-cancel]")!.addEventListener("click", cancel);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      cancel();
    });
    dialog.addEventListener("close", cancel);
    signal.addEventListener("abort", cancel, { once: true });
    window.addEventListener("pagehide", cancel, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}
