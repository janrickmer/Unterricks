// Gespeicherte Feibeitsblatt-Verbindung: Schlüssel aus dem Unterricks-Passwort (zweiter PBKDF2-Block), Umschlag, Prüfung auf dem Server
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveLogin, sealLink, openLink, linkData, sameApi, b64u, unb64u, b64, unb64, LINK_INFO } from "../../public/fblink.js";
import { cleanFbLink } from "../../worker/auth.js";

const subtle = globalThis.crypto.subtle, te = new TextEncoder();
const SALT = b64u(new Uint8Array(16).map((_, i) => i * 7 + 3));
const IT = 1000;   // im Test wenige Iterationen (die Plattform nutzt 600 000)

test("Anmeldeschlüssel bleibt wie bisher (erster PBKDF2-Block) – bestehende Zugänge gelten weiter", async () => {
  const d = await deriveLogin("Geheim-Passwort-1", SALT, IT);
  const key = await subtle.importKey("raw", te.encode("Geheim-Passwort-1"), "PBKDF2", false, ["deriveBits"]);
  const old = b64u(new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(SALT), iterations: IT }, key, 256)));
  assert.equal(d.authKey, old);
  assert.equal(d.wrapKey.extractable, false, "der Schlüssel für die Verbindung lässt sich nicht auslesen");
  assert.deepEqual([...d.wrapKey.usages].sort(), ["decrypt", "encrypt"]);
  assert.equal(LINK_INFO, "unterricks/fb-link/v1");
});

test("Umschlag: nur mit demselben Passwort zu öffnen, Inhalt geprüft, Manipulation fällt auf", async () => {
  const master = new Uint8Array(32).map((_, i) => 255 - i);
  const a = await deriveLogin("Geheim-Passwort-1", SALT, IT), b = await deriveLogin("anderes-Passwort", SALT, IT), a2 = await deriveLogin("Geheim-Passwort-1", SALT, IT);
  const env = await sealLink(a.wrapKey, linkData("https://feibeitsblatt.example.dev", master));
  assert.deepEqual(Object.keys(env).sort(), ["ct", "iv", "v"]);
  assert.ok(!JSON.stringify(env).includes(b64(master)) && !JSON.stringify(env).includes("feibeitsblatt.example"), "nichts im Klartext");
  const d = await openLink(a2.wrapKey, env);   // auf einem anderen Gerät mit demselben Passwort abgeleitet
  assert.deepEqual([...d.master], [...master]);
  assert.equal(d.api, "https://feibeitsblatt.example.dev");
  await assert.rejects(openLink(b.wrapKey, env), "anderes Passwort");
  const ct = unb64(env.ct); ct[3] ^= 1;
  await assert.rejects(openLink(a.wrapKey, { ...env, ct: b64(ct) }), "veränderter Umschlag");
  await assert.rejects(openLink(a.wrapKey, { ...env, v: 2 }));
  // Inhalt mit falscher Schlüssellänge wird abgelehnt
  const bad = await sealLink(a.wrapKey, { ...linkData("https://x", new Uint8Array(31)) });
  await assert.rejects(openLink(a.wrapKey, bad), /Unbekannter Inhalt/);
  assert.ok(sameApi("https://a.example/", "https://a.example") && !sameApi("https://a.example", "https://b.example"));
});

test("Server: nimmt nur einen Umschlag der erwarteten Form an (kein Klartext, keine fremden Felder)", async () => {
  const a = await deriveLogin("Geheim-Passwort-1", SALT, IT);
  const env = await sealLink(a.wrapKey, linkData("https://feibeitsblatt.example.dev", new Uint8Array(32)));
  assert.deepEqual(cleanFbLink({ ...env, master: "x", extra: 1 }), env);
  for (const x of [null, "x", {}, { ...env, v: 2 }, { ...env, iv: "kurz" }, { ...env, ct: "!!!!" }, { ...env, ct: "A".repeat(4004) }, { v: 1, iv: env.iv }]) assert.equal(cleanFbLink(x), null);
});
