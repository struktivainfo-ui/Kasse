import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const required = Object.entries(firebaseConfig).filter(([, v]) => !v);
if (required.length) {
  throw new Error(`Fehlende Firebase Umgebungsvariablen: ${required.map(([k]) => k).join(", ")}`);
}

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateDE = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeDE = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

const ui = {
  splash: byId("splash"), splashTitle: byId("splashTitle"), splashSub: byId("splashSub"),
  loginCard: byId("loginCard"), loginForm: byId("loginForm"), email: byId("email"), password: byId("password"), rememberMe: byId("rememberMe"), loginError: byId("loginError"),
  dashboardCard: byId("dashboardCard"), tableCard: byId("tableCard"), formSection: byId("formSection"), entryForm: byId("entryForm"), formError: byId("formError"),
  userChip: byId("userChip"), roleChip: byId("roleChip"), userMail: byId("userMail"), roleText: byId("roleText"), logoutBtn: byId("logoutBtn"), connectionChip: byId("connectionChip"),
  date: byId("date"), openDatePicker: byId("openDatePicker"), startCash: byId("startCash"), dailyTotal: byId("dailyTotal"), cardPayments: byId("cardPayments"), skimming: byId("skimming"), endCashCounted: byId("endCashCounted"),
  note: byId("note"), hasReceipt: byId("hasReceipt"), receiptNumber: byId("receiptNumber"), receiptNote: byId("receiptNote"),
  saveBtn: byId("saveBtn"), resetBtn: byId("resetBtn"), cancelEditBtn: byId("cancelEditBtn"),
  liveCashShare: byId("liveCashShare"), liveEndExpected: byId("liveEndExpected"), liveDiff: byId("liveDiff"), liveDiffMetric: byId("liveDiffMetric"), liveState: byId("liveState"),
  monthFilter: byId("monthFilter"), openMonthPicker: byId("openMonthPicker"), currentMonthButton: byId("currentMonthButton"), clearFilterButton: byId("clearFilterButton"), reloadButton: byId("reloadButton"),
  printButton: byId("printButton"), csvButton: byId("csvButton"), entriesBody: byId("entriesBody"), tableSummary: byId("tableSummary"),
  sumDaily: byId("sumDaily"), sumCard: byId("sumCard"), sumCash: byId("sumCash"), sumSkim: byId("sumSkim"), sumDiffDays: byId("sumDiffDays"),
  lastDate: byId("lastDate"), lastDiff: byId("lastDiff"), lastBy: byId("lastBy")
};

const state = { auth: null, db: null, user: null, role: null, entries: [], editingId: null, unsub: null, loggingOut: false };

init();

function init() {
  const app = initializeApp(firebaseConfig);
  state.auth = getAuth(app);
  state.db = getFirestore(app);
  ui.monthFilter.value = currentMonthIso();
  ui.date.value = todayIso();
  bindEvents();
  watchConnectivity();
  watchAuth();
  calcLive();
}

function bindEvents() {
  ui.loginForm.addEventListener("submit", onLogin);
  ui.logoutBtn.addEventListener("click", onLogout);
  ui.entryForm.addEventListener("submit", onSave);
  ui.resetBtn.addEventListener("click", resetForm);
  ui.cancelEditBtn.addEventListener("click", cancelEdit);
  ui.currentMonthButton.addEventListener("click", () => { ui.monthFilter.value = currentMonthIso(); render(); });
  ui.clearFilterButton.addEventListener("click", () => { ui.monthFilter.value = ""; render(); });
  ui.monthFilter.addEventListener("change", render);
  ui.reloadButton.addEventListener("click", render);
  ui.printButton.addEventListener("click", () => window.print());
  ui.csvButton.addEventListener("click", exportCsv);
  ui.openDatePicker.addEventListener("click", () => openNativePicker(ui.date));
  ui.openMonthPicker.addEventListener("click", () => openNativePicker(ui.monthFilter));
  [ui.startCash, ui.dailyTotal, ui.cardPayments, ui.skimming, ui.endCashCounted].forEach((el) => {
    el.addEventListener("input", calcLive);
    el.addEventListener("blur", normalizeMoneyInput);
  });
}

function openNativePicker(input) {
  if (!input) return;
  if (typeof input.showPicker === "function") input.showPicker();
  else { input.focus(); input.click(); }
}

function watchConnectivity() {
  const sync = () => {
    const offline = !navigator.onLine;
    ui.connectionChip.classList.toggle("hidden", !offline);
    ui.connectionChip.classList.toggle("alert", offline);
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
}

function watchAuth() {
  onAuthStateChanged(state.auth, async (user) => {
    if (!user) return showLoggedOut();
    state.user = user;
    state.role = await loadRole(user.uid);
    ui.userMail.textContent = user.email || "-";
    ui.roleText.textContent = state.role === "admin" ? "Admin" : "Steuerberater";
    ui.userChip.classList.remove("hidden");
    ui.roleChip.classList.remove("hidden");
    ui.logoutBtn.classList.remove("hidden");
    ui.loginCard.classList.add("hidden");
    ui.dashboardCard.classList.remove("hidden");
    ui.tableCard.classList.remove("hidden");
    ui.formSection.classList.toggle("hidden", state.role !== "admin");
    if (!state.loggingOut) await showSplash(state.role);
    subscribeEntries();
  });
}

async function onLogin(event) {
  event.preventDefault();
  hideError(ui.loginError);
  try {
    await setPersistence(state.auth, ui.rememberMe.checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(state.auth, ui.email.value.trim(), ui.password.value);
    ui.password.value = "";
  } catch {
    showError(ui.loginError, navigator.onLine ? "Login fehlgeschlagen. Bitte E-Mail und Passwort prüfen." : "Verbindung konnte nicht hergestellt werden.");
  }
}

async function onLogout() {
  try {
    state.loggingOut = true;
    await signOut(state.auth);
  } catch {
    showError(ui.loginError, "Abmeldung fehlgeschlagen.");
  }
}

function showLoggedOut() {
  state.user = null;
  state.role = null;
  state.entries = [];
  state.editingId = null;
  ui.loginCard.classList.remove("hidden");
  ui.dashboardCard.classList.add("hidden");
  ui.tableCard.classList.add("hidden");
  ui.userChip.classList.add("hidden");
  ui.roleChip.classList.add("hidden");
  ui.logoutBtn.classList.add("hidden");
  clearTable();
  resetSummary();
  if (state.unsub) { state.unsub(); state.unsub = null; }
  state.loggingOut = false;
}

async function showSplash(role) {
  const h = new Date().getHours();
  const greeting = h >= 5 && h <= 10 ? "Guten Morgen" : h >= 11 && h <= 17 ? "Guten Tag" : "Guten Abend";
  const name = role === "admin" ? "Sven" : "Sarah";
  ui.splashTitle.textContent = `${greeting}, ${name}`;
  ui.splashSub.textContent = role === "admin" ? "Lotto-Kasse Salon Karola" : "Steuerberater-Zugang";
  ui.splash.classList.remove("hidden");
  await wait(1700);
  ui.splash.classList.add("hidden");
}

async function loadRole(uid) {
  try {
    const snap = await getDoc(doc(state.db, "users", uid));
    return snap.exists() && snap.data().role === "admin" ? "admin" : "viewer";
  } catch {
    return "viewer";
  }
}

function subscribeEntries() {
  if (state.unsub) state.unsub();
  const q = query(collection(state.db, "lottoKasse"), orderBy("date", "desc"));
  state.unsub = onSnapshot(q, (snap) => {
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, () => showError(ui.formError, "Verbindung konnte nicht hergestellt werden."));
}

async function onSave(event) {
  event.preventDefault();
  hideError(ui.formError);
  if (state.role !== "admin") return showError(ui.formError, "Nur Admin darf speichern.");
  const entry = buildEntry();
  if (!entry) return;
  try {
    ui.saveBtn.disabled = true;
    ui.saveBtn.textContent = "Wird gespeichert…";
    const ref = doc(state.db, "lottoKasse", entry.date);
    const existing = await getDoc(ref);
    const exists = existing.exists();
    const conflict = (exists && !state.editingId) || (exists && state.editingId && state.editingId !== entry.date);
    if (conflict) {
      const ok = window.confirm("Für dieses Datum gibt es bereits einen Tagesabschluss. Möchtest du aktualisieren?");
      if (!ok) { ui.saveBtn.disabled = false; ui.saveBtn.textContent = "Speichern"; return; }
    }
    const old = exists ? existing.data() : null;
    await setDoc(ref, {
      date: entry.date, startCash: entry.startCash, dailyTotal: entry.dailyTotal, cardPayments: entry.cardPayments,
      cashShare: entry.cashShare, skimming: entry.skimming, endExpected: entry.endExpected, endCashCounted: entry.endCashCounted, diff: entry.diff,
      note: entry.note, hasReceipt: entry.hasReceipt, receiptNumber: entry.receiptNumber, receiptNote: entry.receiptNote,
      updatedAt: serverTimestamp(), updatedBy: state.user.email || "",
      createdAt: old?.createdAt ?? serverTimestamp(), createdBy: old?.createdBy ?? (state.user.email || "")
    });
    ui.saveBtn.textContent = "Gespeichert";
    await wait(700);
    ui.saveBtn.textContent = "Speichern";
    ui.saveBtn.disabled = false;
    resetForm();
  } catch {
    ui.saveBtn.disabled = false;
    ui.saveBtn.textContent = "Speichern";
    showError(ui.formError, "Speichern fehlgeschlagen.");
  }
}

async function deleteEntry(id, dateLabel) {
  if (state.role !== "admin") return;
  if (!window.confirm(`Eintrag vom ${dateLabel} wirklich entfernen?`)) return;
  try {
    await deleteDoc(doc(state.db, "lottoKasse", id));
    if (state.editingId === id) resetForm();
  } catch {
    showError(ui.formError, "Eintrag konnte nicht entfernt werden.");
  }
}

function buildEntry() {
  const date = ui.date.value;
  if (!date) return showFormError("Datum ist Pflicht.");
  const startCash = parseMoney(ui.startCash.value);
  const dailyTotal = parseMoney(ui.dailyTotal.value);
  const cardPayments = parseMoney(ui.cardPayments.value);
  const skimming = parseMoney(ui.skimming.value);
  const endCashCounted = parseMoney(ui.endCashCounted.value);
  const checks = [["Wechselgeld Anfang", startCash], ["Tagesabschluss gesamt", dailyTotal], ["EC-Zahlungen", cardPayments], ["Abschöpfung", skimming], ["Wechselgeld Ende gezählt", endCashCounted]];
  for (const [label, value] of checks) {
    if (value === null) return showFormError(`${label}: ungültiger Betrag.`);
    if (value < 0) return showFormError(`${label}: keine negativen Werte erlaubt.`);
  }
  if (cardPayments > dailyTotal) return showFormError("EC-Zahlungen dürfen nicht höher als der Tagesabschluss gesamt sein.");
  const cashShare = round2(dailyTotal - cardPayments);
  const endExpected = round2(startCash + cashShare - skimming);
  const diff = round2(endCashCounted - endExpected);
  return {
    date, startCash, dailyTotal, cardPayments, cashShare, skimming, endExpected, endCashCounted, diff,
    note: ui.note.value.trim(), hasReceipt: ui.hasReceipt.value === "true", receiptNumber: ui.receiptNumber.value.trim(), receiptNote: ui.receiptNote.value.trim()
  };
}

function calcLive() {
  const startCash = parseMoney(ui.startCash.value) ?? 0;
  const dailyTotal = parseMoney(ui.dailyTotal.value) ?? 0;
  const cardPayments = parseMoney(ui.cardPayments.value) ?? 0;
  const skimming = parseMoney(ui.skimming.value) ?? 0;
  const endCashCounted = parseMoney(ui.endCashCounted.value) ?? 0;
  const cashShare = round2(dailyTotal - cardPayments);
  const endExpected = round2(startCash + cashShare - skimming);
  const diff = round2(endCashCounted - endExpected);
  ui.liveCashShare.textContent = money(cashShare);
  ui.liveEndExpected.textContent = money(endExpected);
  ui.liveDiff.textContent = money(diff);
  ui.liveDiffMetric.classList.toggle("ok", diff === 0);
  ui.liveDiffMetric.classList.toggle("bad", diff !== 0);
  ui.liveState.textContent = diff === 0 ? "OK" : "Prüfen";
}

function render() {
  const entries = filteredEntries();
  ui.entriesBody.innerHTML = "";
  if (!entries.length) {
    ui.entriesBody.innerHTML = '<tr><td colspan="17" class="empty">Keine Einträge vorhanden.</td></tr>';
    resetSummary();
    return;
  }
  for (const entry of entries) {
    const diffOk = round2(num(entry.diff)) === 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(formatDate(entry.date))}</td><td class="num">${money(entry.startCash)}</td><td class="num">${money(entry.dailyTotal)}</td><td class="num">${money(entry.cardPayments)}</td><td class="num">${money(entry.cashShare)}</td><td class="num">${money(entry.skimming)}</td><td class="num">${money(entry.endExpected)}</td><td class="num">${money(entry.endCashCounted)}</td><td class="num">${money(entry.diff)}</td><td><span class="badge ${diffOk ? "ok" : "bad"}">${diffOk ? "OK" : "Prüfen"}</span></td><td title="${esc(entry.note || "")}"><div class="truncate">${esc(entry.note || "") || "—"}</div></td><td>${entry.hasReceipt ? "Ja" : "Nein"}</td><td title="${esc(entry.receiptNumber || "")}"><div class="truncate">${esc(entry.receiptNumber || "") || "—"}</div></td><td title="${esc(entry.receiptNote || "")}"><div class="truncate">${esc(entry.receiptNote || "") || "—"}</div></td><td>${esc(entry.updatedBy || "—")}</td><td>${entry.updatedAt?.toDate ? dateTimeDE.format(entry.updatedAt.toDate()) : "—"}</td><td class="table-actions">${state.role === "admin" ? `<button class="btn btn-muted" type="button" data-edit="${entry.id}">Bearbeiten</button> <button class="btn btn-danger" type="button" data-del="${entry.id}" data-label="${esc(formatDate(entry.date))}">Eintrag entfernen</button>` : "—"}</td>`;
    ui.entriesBody.appendChild(tr);
  }
  if (state.role === "admin") {
    ui.entriesBody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editEntry(b.getAttribute("data-edit"))));
    ui.entriesBody.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteEntry(b.getAttribute("data-del"), b.getAttribute("data-label"))));
  }
  renderSummary(entries);
  const last = [...state.entries].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  ui.lastDate.textContent = last ? formatDate(last.date) : "-";
  ui.lastDiff.textContent = last ? money(last.diff) : "0,00 €";
  ui.lastBy.textContent = last?.updatedBy || last?.createdBy || "-";
  ui.tableSummary.textContent = `${entries.length} Tag${entries.length === 1 ? "" : "e"} angezeigt${ui.monthFilter.value ? ` (${monthLabel(ui.monthFilter.value)})` : ""}.`;
}

function renderSummary(entries) {
  const sums = entries.reduce((acc, e) => {
    acc.daily += num(e.dailyTotal); acc.card += num(e.cardPayments); acc.cash += num(e.cashShare); acc.skim += num(e.skimming);
    if (round2(num(e.diff)) !== 0) acc.diffDays += 1;
    return acc;
  }, { daily: 0, card: 0, cash: 0, skim: 0, diffDays: 0 });
  ui.sumDaily.textContent = money(sums.daily);
  ui.sumCard.textContent = money(sums.card);
  ui.sumCash.textContent = money(sums.cash);
  ui.sumSkim.textContent = money(sums.skim);
  ui.sumDiffDays.textContent = String(sums.diffDays);
}

function editEntry(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e || state.role !== "admin") return;
  state.editingId = id;
  ui.date.value = e.date || todayIso();
  ui.startCash.value = toInput(e.startCash);
  ui.dailyTotal.value = toInput(e.dailyTotal);
  ui.cardPayments.value = toInput(e.cardPayments);
  ui.skimming.value = toInput(e.skimming);
  ui.endCashCounted.value = toInput(e.endCashCounted);
  ui.note.value = e.note || "";
  ui.hasReceipt.value = e.hasReceipt ? "true" : "false";
  ui.receiptNumber.value = e.receiptNumber || "";
  ui.receiptNote.value = e.receiptNote || "";
  ui.saveBtn.textContent = "Aktualisieren";
  ui.cancelEditBtn.classList.remove("hidden");
  calcLive();
  hideError(ui.formError);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelEdit() {
  state.editingId = null;
  ui.saveBtn.textContent = "Speichern";
  ui.cancelEditBtn.classList.add("hidden");
}

function resetForm() {
  ui.entryForm.reset();
  ui.date.value = todayIso();
  ui.hasReceipt.value = "false";
  ui.receiptNumber.value = "";
  ui.receiptNote.value = "";
  cancelEdit();
  calcLive();
  hideError(ui.formError);
  ui.saveBtn.disabled = false;
  ui.saveBtn.textContent = "Speichern";
}

function filteredEntries() {
  const month = ui.monthFilter.value;
  const rows = [...state.entries].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!month) return rows;
  return rows.filter((e) => String(e.date).startsWith(month));
}

function exportCsv() {
  const rows = filteredEntries().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const header = ["Datum", "Wechselgeld Anfang", "Tagesabschluss gesamt", "EC-Zahlungen", "Bar-Anteil", "Abschöpfung", "Wechselgeld Ende Soll", "Wechselgeld Ende gezählt", "Differenz", "Status", "Bemerkung", "Beleg vorhanden", "Belegnummer", "Beleg-Hinweis", "Bearbeitet von", "Bearbeitet am"];
  const data = rows.map((e) => {
    const diffOk = round2(num(e.diff)) === 0;
    return [e.date || "", toCsv(e.startCash), toCsv(e.dailyTotal), toCsv(e.cardPayments), toCsv(e.cashShare), toCsv(e.skimming), toCsv(e.endExpected), toCsv(e.endCashCounted), toCsv(e.diff), diffOk ? "OK" : "Prüfen", e.note || "", e.hasReceipt ? "Ja" : "Nein", e.receiptNumber || "", e.receiptNote || "", e.updatedBy || "", e.updatedAt?.toDate ? dateTimeDE.format(e.updatedAt.toDate()) : ""];
  });
  const csv = [header, ...data].map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\n");
  const month = ui.monthFilter.value || "gesamt";
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lotto-kasse-salon-karola-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function clearTable() { ui.entriesBody.innerHTML = ""; ui.tableSummary.textContent = ""; }
function resetSummary() {
  ui.sumDaily.textContent = "0,00 €";
  ui.sumCard.textContent = "0,00 €";
  ui.sumCash.textContent = "0,00 €";
  ui.sumSkim.textContent = "0,00 €";
  ui.sumDiffDays.textContent = "0";
  ui.lastDate.textContent = "-";
  ui.lastDiff.textContent = "0,00 €";
  ui.lastBy.textContent = "-";
}
function normalizeMoneyInput(e) {
  const n = parseMoney(e.target.value);
  if (n !== null) e.target.value = toInput(n);
  calcLive();
}
function parseMoney(v) {
  const t = String(v ?? "").trim();
  if (!t) return 0;
  const s = t.replace(/€/g, "").replace(/\s/g, "");
  const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(n) && !/^-?\d+$/.test(n)) return null;
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  return round2(value);
}
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v) { return euro.format(num(v)); }
function toInput(v) { return round2(num(v)).toFixed(2).replace(".", ","); }
function toCsv(v) { return round2(num(v)).toFixed(2).replace(".", ","); }
function formatDate(iso) { return iso ? dateDE.format(new Date(`${iso}T12:00:00`)) : ""; }
function monthLabel(m) { const [y, mm] = m.split("-"); return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(Number(y), Number(mm) - 1, 1)); }
function todayIso() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function currentMonthIso() { return todayIso().slice(0, 7); }
function showError(el, msg) { el.textContent = msg; el.classList.add("show"); }
function hideError(el) { el.textContent = ""; el.classList.remove("show"); }
function showFormError(msg) { showError(ui.formError, msg); return null; }
function byId(id) { return document.getElementById(id); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function esc(v) {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
