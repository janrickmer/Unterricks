import test from "node:test";
import assert from "node:assert/strict";
import { cleanPhoto, PHOTO_TASKS_MAX } from "../../public/fbclient.js";

test("Foto einer Abgabe: nur ein JPEG als data:-URL wie vom Feibeitsblatt (fremde Daten)", () => {
  const ok = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
  assert.equal(cleanPhoto(ok), ok);
  for (const bad of [null, 42, "data:image/png;base64,iVBORw0KGgo=", "data:image/jpeg;base64,/9j/4AAQ SkZJ", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=", "javascript:alert(1)",
    "data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,/9j/" + "A".repeat(280000)]) assert.equal(cleanPhoto(bad), null, String(bad).slice(0, 40));
  assert.equal(PHOTO_TASKS_MAX, 3);
});
