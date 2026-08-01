"use strict";
// ═══════════════════════════════════════════════════════════════
// render-build.js
// ─────────────────────────────────────────────────────────────
// Render-এর "Build Command" ধাপে চলে (সার্ভার চালু হওয়ার আগে, তাই এখানে
// সময় নিয়ে synchronous কাজ করলে কোনো 502/ফ্রিজ সমস্যা হয় না — কেউ তখনও
// সাইটে রিকোয়েস্ট পাঠাতে পারছে না)।
//
// কাজ: রিপোর পাশে রাখা bot zip খুঁজে বের করে bot/ ফোল্ডারে extract করে,
// তারপর bot/-এর ভিতরে npm install চালিয়ে দেয় — যাতে সার্ভার চালু হওয়ার
// সময় (runtime) আর কোনো npm install লাগেই না। এটাই runtime-এ ১১+ মিনিট
// ধরে npm install আটকে থাকার সমস্যার আসল সমাধান।
//
// Render Dashboard → Settings → Build Command এ বসাও:
//   npm install && node render-build.js
// ═══════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const BDIR = path.join(ROOT, "bot");

function log(msg) { console.log("[render-build] " + msg); }

async function main() {
  // ১. রিপোর মূলে থাকা .zip ফাইল খুঁজে বের করা (server.js এর runtime auto-import
  //    যেভাবে খোঁজে ঠিক সেই একই কনভেনশন — প্রথম .zip ফাইলটা নেওয়া হয়)
  const zipFiles = fs.readdirSync(ROOT).filter(f => f.toLowerCase().endsWith(".zip"));
  if (zipFiles.length === 0) {
    log("রিপোতে কোনো .zip ফাইল পাওয়া যায়নি — এই ধাপ স্কিপ করা হলো (bot runtime-এ import হবে)");
    return;
  }
  const zipPath = path.join(ROOT, zipFiles[0]);
  log("ZIP পাওয়া গেছে: " + zipFiles[0] + " — extract করা হচ্ছে...");

  let unzipper;
  try { unzipper = require("unzipper"); }
  catch { log("⚠️ unzipper প্যাকেজ পাওয়া যায়নি (npm install আগে চালাতে হবে) — স্কিপ করা হলো"); return; }

  const tmpX = path.join(require("os").tmpdir(), "build_xtr_" + Date.now());
  fs.mkdirSync(tmpX, { recursive: true });
  try {
    const zipDir = await unzipper.Open.file(zipPath);
    await zipDir.extract({ path: tmpX, concurrency: 5 });
  } catch (e) {
    log("❌ ZIP extract ব্যর্থ (করাপ্ট/অসম্পূর্ণ হতে পারে): " + e.message);
    log("   এই ধাপ স্কিপ করা হলো — bot runtime-এ normal ভাবে import/install হওয়ার চেষ্টা করবে");
    return;
  }
  ["__MACOSX", ".DS_Store"].forEach(j => {
    const jj = path.join(tmpX, j);
    if (fs.existsSync(jj)) fs.rmSync(jj, { recursive: true, force: true });
  });

  // auto-flatten (zip এর ভিতরে একটাই wrapper ফোল্ডার থাকলে সেটার ভিতরের কনটেন্ট নেওয়া)
  let src = tmpX;
  const nonDot = fs.readdirSync(tmpX).filter(f => !f.startsWith("."));
  if (nonDot.length === 1) {
    const s = path.join(tmpX, nonDot[0]);
    if (fs.statSync(s).isDirectory()) src = s;
  }

  fs.mkdirSync(BDIR, { recursive: true });
  function cpR(s, d) {
    fs.mkdirSync(d, { recursive: true });
    fs.readdirSync(s).forEach(n => {
      const ss = path.join(s, n), dd = path.join(d, n);
      if (fs.statSync(ss).isDirectory()) cpR(ss, dd);
      else fs.copyFileSync(ss, dd);
    });
  }
  cpR(src, BDIR);
  fs.rmSync(tmpX, { recursive: true, force: true });
  log("✅ ZIP extract সম্পন্ন → bot/");

  // ২. bot/ এর ভিতরে npm install (এখানে synchronous/blocking করলেও সমস্যা নেই —
  //    সার্ভার তখনও চালু হয়নি, তাই কেউ 502 পাবে না)
  const pkgPath = path.join(BDIR, "package.json");
  if (!fs.existsSync(pkgPath)) {
    log("⚠️ bot/package.json পাওয়া যায়নি — npm install স্কিপ করা হলো");
    return;
  }
  const hasLock = fs.existsSync(path.join(BDIR, "package-lock.json"));
  const cmd = hasLock ? "npm ci --omit=dev --no-audit --no-fund" : "npm install --omit=dev --no-audit --no-fund --prefer-offline";
  log("bot/ এর ভিতরে চলছে: " + cmd + " (এটা কয়েক মিনিট লাগতে পারে, স্বাভাবিক)");
  try {
    execSync(cmd, { cwd: BDIR, stdio: "inherit", timeout: 20 * 60 * 1000 });
    log("✅ bot dependencies install সম্পন্ন — runtime-এ আর install লাগবে না, সাথে সাথে বট চালু হবে");
  } catch (e) {
    log("❌ bot npm install ব্যর্থ: " + e.message);
    log("   Build ব্যর্থ হয়ে যাবে না (deploy চলবে), কিন্তু runtime-এ আবার install চেষ্টা হবে");
  }
}

main().catch(e => { log("❌ অপ্রত্যাশিত সমস্যা: " + e.message); });
