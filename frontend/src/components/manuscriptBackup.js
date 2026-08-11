// Backup and restore of everything the reader has produced.
//
// Comments, headings, catalogue cards, folio settings, fold overrides and page
// orders all live in localStorage inside Electron's user-data folder. Until now
// there was no way to move that to another machine, keep a copy before a version
// upgrade, or get it back after Windows was reinstalled — and a researcher's
// months of annotation is the most valuable thing this program holds. The Word
// export is not a substitute: it produces text, and nothing reads it back.

export const BACKUP_FORMAT = "manuscript-browser-backup";
export const BACKUP_VERSION = 1;

// Everything worth carrying. Keys are stored without the pane namespace suffix so
// a backup taken in pane A restores into pane B, or into a single-pane install.
export const BACKUP_KEYS = [
  "manuscriptRulerState.v1",
  "manuscriptRulerBookmarks.v1",
  "manuscriptRulerComments.v1",
  "manuscriptRulerInfo.v1",
  "manuscriptRulerHeadings.v1",
  "manuscriptRulerFoldOverrides.v1",
  "manuscriptRulerPageOrder.v1",
  "manuscriptRulerRecents.v1",
  "manuscriptRulerAutoBM.v1",
  "manuscriptRulerPerFileSettings.v1",
];

// The subset that decides whether a close-time reminder has anything to say.
// Bookmarks, comments, headings, catalogue entries, fold adjustments and page
// orders are deliberate work a reader would mind losing. State, recents,
// auto-bookmark and per-file display settings are still in the backup file
// above — restoring them is convenient — but they rewrite themselves on
// practically every page turn, so keying a reminder off them would nag on every
// session regardless of whether the reader wrote a single word.
const REMINDER_KEYS = [
  "manuscriptRulerBookmarks.v1",
  "manuscriptRulerComments.v1",
  "manuscriptRulerInfo.v1",
  "manuscriptRulerHeadings.v1",
  "manuscriptRulerFoldOverrides.v1",
  "manuscriptRulerPageOrder.v1",
];

// Count the manuscripts represented, so the reader can see the backup is not empty
// and can tell one backup file from another.
export function summarise(data) {
  const files = new Set();
  for (const key of ["manuscriptRulerComments.v1", "manuscriptRulerHeadings.v1", "manuscriptRulerInfo.v1"]) {
    const map = data[key];
    if (map && typeof map === "object") for (const k of Object.keys(map)) files.add(k);
  }
  const countEntries = (key) => {
    const map = data[key];
    if (!map || typeof map !== "object") return 0;
    return Object.values(map).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  };
  return {
    manuscripts: files.size,
    comments: countEntries("manuscriptRulerComments.v1"),
    headings: countEntries("manuscriptRulerHeadings.v1"),
  };
}

// A cheap way to notice "does this differ from the last backup", so a reminder
// can fire at session end without hooking every place that writes a bookmark, a
// comment, a heading or a page order. Recomputed on demand instead of tracked
// continuously - nothing about how those are saved day to day changes. Not
// cryptographic: a collision here would only mean an occasional missed reminder,
// never a corrupted backup, since the restore path never touches this.
function hashJSON(value) {
  const str = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36) + ":" + str.length;
}

// A catalogue card is auto-filled with `type: "single"` and, where the filename
// carries them, `number` and `library` - the moment a file is opened, before the
// reader has typed anything. Only the fields nobody fills in automatically say
// anything about deliberate work.
function meaningfulInfoFields(info) {
  const { title, author, copyist, copyDate, titlesList, notes } = info || {};
  return { title, author, copyist, copyDate, titlesList, notes };
}

// Only the keys a reminder should key off, in case `data` is a full backup
// payload (which also carries state/recents/auto-bookmark/per-file settings that
// rewrite themselves on nearly every page turn - hashing those would make the
// reminder fire every session regardless of whether real work happened). Catalogue
// entries get the further trim above: opening any file already leaves one behind.
function reminderSnapshot(data) {
  const snap = {};
  for (const key of REMINDER_KEYS) {
    const v = data[key];
    if (v == null) continue;
    if (key === "manuscriptRulerInfo.v1" && typeof v === "object") {
      const trimmed = {};
      for (const [fileKey, info] of Object.entries(v)) {
        const meaningful = meaningfulInfoFields(info);
        if (Object.values(meaningful).some(Boolean)) trimmed[fileKey] = meaningful;
      }
      if (Object.keys(trimmed).length > 0) snap[key] = trimmed;
      continue;
    }
    snap[key] = v;
  }
  return snap;
}

export function backupContentHash(data) {
  return hashJSON(reminderSnapshot(data));
}

// True once there is at least one bookmark, comment, heading, catalogue field the
// reader actually typed, fold override or page order recorded - something a
// reminder would actually be protecting. A key can exist with nothing in it (the
// last bookmark on a page got deleted, leaving behind an empty array; a card
// left with only its auto-filled number), so presence of the key is not enough;
// the value has to hold something a reader put there on purpose.
export function hasBackupWorthyContent(data) {
  const snap = reminderSnapshot(data);
  for (const key of REMINDER_KEYS) {
    const v = snap[key];
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) return true;
      continue;
    }
    if (typeof v === "object") {
      if (Object.keys(v).length > 0) return true;
      continue;
    }
    if (v) return true;
  }
  return false;
}

export function buildBackup(readKey) {
  const data = {};
  for (const key of BACKUP_KEYS) {
    const raw = readKey(key);
    if (raw == null) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      // keep it verbatim rather than dropping a key we cannot parse
      data[key] = raw;
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    summary: summarise(data),
    data,
  };
}

// Returns { ok, data, summary } or { ok: false, error } — never throws, because
// the file comes from wherever the reader kept it.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "الملف ليس نسخة احتياطية صالحة (تعذّرت قراءته)" };
  }
  if (!parsed || parsed.format !== BACKUP_FORMAT) {
    return { ok: false, error: "هذا الملف ليس نسخة احتياطية من متصفح المخطوطات" };
  }
  if (!(parsed.version <= BACKUP_VERSION)) {
    return { ok: false, error: "النسخة الاحتياطية أحدث من هذا الإصدار — حدّث البرنامج أولاً" };
  }
  if (!parsed.data || typeof parsed.data !== "object") {
    return { ok: false, error: "النسخة الاحتياطية لا تحتوي على بيانات" };
  }
  // Only restore keys we know; ignore anything else in the file.
  const data = {};
  for (const key of BACKUP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed.data, key)) data[key] = parsed.data[key];
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "النسخة الاحتياطية فارغة" };
  }
  return { ok: true, data, summary: summarise(data), savedAt: parsed.savedAt || null };
}

// Merge rather than replace: a restore should add another machine's work to this
// one, not wipe what is already here. Per manuscript, the incoming entry wins only
// where this install has nothing, so restoring twice is harmless.
export function mergeInto(existingRaw, incoming) {
  let existing;
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : null;
  } catch {
    existing = null;
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return incoming;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return existing;
  const out = { ...existing };
  for (const [fileKey, value] of Object.entries(incoming)) {
    const mine = out[fileKey];
    const mineEmpty = mine == null || (Array.isArray(mine) && mine.length === 0);
    if (mineEmpty) out[fileKey] = value;
  }
  return out;
}
