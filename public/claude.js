// claude.js – Übergabe an Claude (claude.ai, Pro-Abo über den Connector): Modell und Aufwand erfragen, Prompt kopieren, claude.ai öffnen.
// Die Plattform kann das Modell in claude.ai nicht selbst einstellen (keine API) – sie erfragt die Wahl und erinnert daran.
import { h, modal, copyText, toast, store } from "./ui.js";

export const MODELS = [
  ["opus", "Claude Opus", "Empfehlung für Planung und Material: sehr gute Qualität"],
  ["top", "Leistungsstärkstes verfügbares Modell", "z. B. Fable – falls es Ihr Abo anbietet; langsamer"],
  ["sonnet", "Claude Sonnet", "schneller, für einfachere Aufgaben"],
];
export const EFFORTS = [
  ["high", "Gründlich (erweitertes Denken)", "Empfehlung"],
  ["max", "Maximal", "falls claude.ai diese Stufe anbietet; dauert länger"],
  ["normal", "Normal", "schnelle Antworten"],
];
const pick = (k, list, def) => { const v = store.get(k); return list.some((x) => x[0] === v) ? v : def; };

/* opt = { title, prompt (String oder Funktion), intro, after, chatName (optional, Funktion oder String) } */
export function claudeHandoff(opt) {
  let model = pick("u.claude.model", MODELS, "opus"), effort = pick("u.claude.effort", EFFORTS, "high");
  const radios = (name, list, cur, set) => h("div", { class: "stack", role: "radiogroup", "aria-label": name }, list.map(([v, label, hint]) => h("label", { style: { fontWeight: 400, display: "flex", gap: ".5rem", alignItems: "flex-start" } },
    h("input", { type: "radio", name, value: v, checked: v === cur ? true : null, onchange: () => set(v) }), h("span", null, h("strong", { text: label }), h("span", { class: "muted small", text: " – " + hint })))));
  modal({ title: opt.title || "Mit Claude weiterarbeiten", wide: true, body: (el) => el.append(
    opt.intro ? h("p", { class: "small", text: opt.intro }) : null,
    h("div", { class: "meta-grid" },
      h("div", null, h("h3", { text: "Welches Sprachmodell?" }), radios("cm", MODELS, model, (v) => { model = v; store.set("u.claude.model", v); })),
      h("div", null, h("h3", { text: "Mit welchem Aufwand?" }), radios("ce", EFFORTS, effort, (v) => { effort = v; store.set("u.claude.effort", v); }))),
    opt.chatName ? (() => {
      const name = typeof opt.chatName === "function" ? opt.chatName() : opt.chatName;
      return h("div", { class: "notice", style: { marginTop: ".8rem" } }, h("strong", { text: "Name des Chats: " }), h("span", { class: "mono", text: name }), " ",
        h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(name)) ? "Chat-Name kopiert." : "Kopieren nicht möglich.", "ok") }, "Chat-Namen kopieren"),
        h("p", { class: "hint", text: "Der Name steht ganz oben im Prompt, und Claude nennt ihn in der ersten Antwort. Den Namen eines Chats vergibt claude.ai selbst – passt er nicht, in claude.ai oben auf den Chat-Titel klicken, „Umbenennen“ wählen und den Namen einfügen." }));
    })() : null,
    h("ol", { class: "small", style: { marginTop: ".8rem" } },
      h("li", null, "Klicken Sie auf „Prompt kopieren“ und öffnen Sie claude.ai."),
      h("li", null, "Stellen Sie dort im Modellmenü das gewählte Modell und – falls angeboten – den Denkaufwand ein (die Plattform kann das in claude.ai nicht selbst einstellen)."),
      h("li", null, "Aktivieren Sie im Chat den Connector „Unterricks“ und fügen Sie den Prompt ein. Beim ersten Mal fragt claude.ai, ob der Connector verbunden werden und auf die Plattform zugreifen darf – bitte erlauben."),
      h("li", null, opt.after || "Wenn Claude fertig ist und gespeichert hat, kommen Sie hierher zurück – die Seite lädt die Ergebnisse beim Zurückkehren neu.")),
    h("p", { class: "hint", text: "Der Connector wird einmalig unter Einstellungen → Claude-Connector eingerichtet. Ohne Connector kann Claude nichts in der Plattform speichern." })),
    actions: [
      { label: "Schließen" },
      { label: "claude.ai öffnen", onClick: () => { window.open("https://claude.ai/new", "_blank", "noopener"); return false; } },
      { label: "Prompt kopieren", class: "primary", onClick: async () => {
        const p = typeof opt.prompt === "function" ? opt.prompt({ model, effort }) : opt.prompt;
        toast((await copyText(p)) ? "Prompt kopiert – jetzt in claude.ai einfügen." : "Kopieren nicht möglich.", "ok");
        return false;
      } },
    ] });
}
