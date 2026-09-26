import createQpdf from "@neslinesli93/qpdf-wasm";
/** Runs only in a short-lived worker in the app. Never log QPDF diagnostics/passwords. */
export async function decryptPdf(
  bytes: Uint8Array,
  password: string,
  wasmUrl: string,
) {
  if (bytes.length > 25 * 1024 * 1024) throw new Error("LIMIT");
  if (password.includes("\0") || password.length > 1024)
    throw new Error("PASSWORD");
  let stdout = "",
    stderr = "";
  const options = {
    locateFile: () => wasmUrl,
    noFSInit: true,
  };
  const q = await createQpdf(options);
  const fs = q.FS as typeof q.FS & {
    init(
      input: null,
      out: (byte: number) => void,
      err: (byte: number) => void,
    ): void;
    writeFile(path: string, bytes: Uint8Array): void;
    unlink(path: string): void;
  };
  fs.init(
    null,
    (byte) => {
      if (stdout.length < 20000) stdout += String.fromCharCode(byte);
    },
    (byte) => {
      if (stderr.length < 20000) stderr += String.fromCharCode(byte);
    },
  );
  try {
    fs.writeFile("/input.pdf", bytes);
    const infoCode = q.callMain([
      `--password=${password}`,
      "--json",
      "--json-key=encrypt",
      "/input.pdf",
    ]);
    if (infoCode !== 0 && infoCode !== 3)
      throw new Error(
        /invalid password/i.test(stderr) ? "PASSWORD" : "UNSUPPORTED",
      );
    const { encrypt } = JSON.parse(stdout);
    if (!encrypt || !encrypt.encrypted) throw new Error("UNSUPPORTED");
    if (!encrypt.ownerpasswordmatched && encrypt.capabilities?.modify !== true)
      throw new Error("PERMISSION");
    stdout = stderr = "";
    const code = q.callMain([
      `--password=${password}`,
      "--decrypt",
      "/input.pdf",
      "/output.pdf",
    ]);
    if (code !== 0 && code !== 3) throw new Error("UNSUPPORTED");
    const output = fs.readFile("/output.pdf").slice();
    if (output.length > 25 * 1024 * 1024) throw new Error("LIMIT");
    return output;
  } finally {
    password = stdout = stderr = "";
    for (const path of ["/input.pdf", "/output.pdf"]) {
      try {
        fs.unlink(path);
      } catch {
        /* May not exist on failed authentication. */
      }
    }
  }
}
