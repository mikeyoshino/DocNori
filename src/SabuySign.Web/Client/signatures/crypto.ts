import { validateSignature, type SignatureData } from "./data";
export const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export const decode = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export const newSecret = () =>
  encode(crypto.getRandomValues(new Uint8Array(32)));
export async function hashSecret(token: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function importKey(key: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key))
    throw new Error("ลิงก์ลายเซ็นไม่ถูกต้อง");
  return crypto.subtle.importKey("raw", decode(key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const aad = (id: string) =>
  new TextEncoder().encode(`SabuySign.signature.v1:${id}`);
export async function encryptSignature(
  data: SignatureData,
  key: string,
  session: string,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(
    JSON.stringify(validateSignature(data)),
  );
  if (bytes.length > 120000) throw new Error("ลายเซ็นมีรายละเอียดมากเกินไป");
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(session) },
    await importKey(key),
    bytes,
  );
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}
export async function decryptSignature(
  data: Uint8Array,
  key: string,
  session: string,
): Promise<SignatureData> {
  if (data.length < 29 || data.length > 128000)
    throw new Error("ข้อมูลลายเซ็นไม่ถูกต้อง");
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: data.slice(0, 12), additionalData: aad(session) },
    await importKey(key),
    data.slice(12),
  );
  return validateSignature(JSON.parse(new TextDecoder().decode(bytes)));
}
