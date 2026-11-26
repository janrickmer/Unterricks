import test from "node:test";
import assert from "node:assert/strict";
import { cleanPhoto, PHOTO_TASKS_MAX, FbClient } from "../../public/fbclient.js";

test("Foto einer Abgabe: nur ein JPEG als data:-URL wie vom Feibeitsblatt (fremde Daten)", () => {
  const ok = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
  assert.equal(cleanPhoto(ok), ok);
  for (const bad of [null, 42, "data:image/png;base64,iVBORw0KGgo=", "data:image/jpeg;base64,/9j/4AAQ SkZJ", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=", "javascript:alert(1)",
    "data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,/9j/" + "A".repeat(280000)]) assert.equal(cleanPhoto(bad), null, String(bad).slice(0, 40));
  assert.equal(PHOTO_TASKS_MAX, 3);
});

test("createSheet: Vorgaben einer Tabelle gehen als answer.cells ans Feibeitsblatt (bereinigt)", async () => {
  const real = globalThis.fetch; let sent = null;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, code: "ABC234" }), { status: 200 }); };
  try {
    const c = new FbClient("https://fb.example"); c.authKey = "k"; c.priv = {};
    await c.createSheet({ title: "T", tasks: [
      { text: "Trage ein.", solution: "Achte auf Rom.", answer: { type: "table", columns: ["Land", "Hauptstadt"], rows: 2, cells: [["Italien", ""], [], ["", ""]] } },
      { text: "Ohne Vorgaben.", solution: "x", answer: { type: "table", columns: ["A"], rows: 2 } }] });
  } finally { globalThis.fetch = real; }
  assert.deepEqual(sent.tasks[0].answer, { type: "table", columns: ["Land", "Hauptstadt"], rows: 2, cells: [["Italien", ""]] });
  assert.deepEqual(sent.tasks[1].answer, { type: "table", columns: ["A"], rows: 2 });
});
