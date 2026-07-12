/* ─────────────────────────────────────────────────────────────────────────────────────────────────
   holo-monad-arrival.js — the boot ceremony played ONCE per sign-in, on the login → home handoff.

   After John Dee's Monas Hieroglyphica (1564), the first theorems: a point → the straight line turns
   and produces the circle around it (point + circle = the monad) → that central point rises to the
   crown and becomes the sun that keeps the measure of your day. The circle it draws IS the day-ring,
   so the monad simply becomes your clock; the overlay then cross-dissolves to reveal the desktop.

   Self-contained, dependency-free, additive. Gated on the one-shot sessionStorage flag `holo:arrival`
   set by sddm.enterShell(), so it fires only on a real sign-in — never on reload or tab re-entry.
   Honours prefers-reduced-motion (skips silently) and never runs inside an app iframe.
   ───────────────────────────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var FLAG = "holo:arrival";
  if (window.top !== window.self) return;                         // top document only, never inside an app frame
  if (window.__holoMonadArrival) return; window.__holoMonadArrival = true;   // one instance per document
  // The desktop shell viewed at phone size hands off to home-screen.html (shell.html's own redirect).
  // In that case let THAT page play the ceremony — bail here WITHOUT consuming the one-shot flag.
  var phone = false;
  try { phone = (window.matchMedia && matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) <= 600) || innerWidth <= 600; } catch (e) {}
  var forcedDesktop = false; try { forcedDesktop = /[?&]desktop=1\b/.test(location.search); } catch (e) {}
  if (window.__holoArrivalHome === "desktop" && phone && !forcedDesktop) return;
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;  // no motion → no ceremony
  // ?arrival=1 — an explicit replay hatch (QA / "show me again"): plays the ceremony without a sign-in.
  var replay = false; try { replay = /[?&]arrival=1\b/.test(location.search); } catch (e) {}

  var played = false;
  function play() {
    if (played) return; played = true;
    var DOC = document, ROOT = DOC.documentElement;
  var light = false;
  try { light = ROOT.getAttribute("data-holo-palette") === "light"; } catch (e) {}
  // a calm cosmos veil that matches the galaxy wallpaper (dark) or the light surface — the ceremony
  // plays over it, then it fades to reveal the real desktop + wallpaper beneath.
  var veilBg = light
    ? "radial-gradient(150% 120% at 50% 12%, #eef1f7 0%, #e7e4de 55%, #dedbd3 100%)"
    : "radial-gradient(150% 120% at 50% 14%, #0d1322 0%, #090d17 44%, #04060c 100%)";

  // ── the overlay — appended to <html> immediately so it covers before the desktop can flash ──
  var host = DOC.createElement("div");
  host.setAttribute("data-holo-arrival", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;" +
    "display:grid;place-items:center;opacity:1;" +
    "color:var(--holo-ink," + (light ? "#14171d" : "#e6edfa") + ");" +
    "font-family:var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);" +
    "-webkit-font-smoothing:antialiased;transition:opacity .7s cubic-bezier(.4,0,.2,1);";

  var veil = DOC.createElement("div");
  veil.style.cssText = "position:absolute;inset:0;background:" + veilBg + ";";
  host.appendChild(veil);

  var stage = DOC.createElement("div");
  stage.style.cssText = "position:relative;width:min(80vmin,500px);aspect-ratio:1;display:grid;place-items:center;";
  stage.innerHTML =
    '<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block;overflow:visible;color:inherit">' +
      '<circle class="ma-ring" cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-opacity="0" stroke-width="2.7" stroke-linecap="round" transform="rotate(-90 50 50)"></circle>' +
      '<circle class="ma-prog" cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-opacity="0" stroke-width="2.7" stroke-linecap="round" transform="rotate(-90 50 50)"></circle>' +
      '<line class="ma-radius" x1="50" y1="50" x2="50" y2="8" stroke="currentColor" stroke-opacity="0" stroke-width="0.8" stroke-linecap="round"></line>' +
      '<circle class="ma-dot" cx="50" cy="50" r="0" fill="currentColor"></circle>' +
    '</svg>' +
    '<div style="position:absolute;text-align:center;line-height:1.05;pointer-events:none">' +
      '<div class="ma-big" style="font-weight:200;font-variant-numeric:tabular-nums;letter-spacing:-.01em;font-size:clamp(30px,12vmin,60px);opacity:0"></div>' +
      '<div class="ma-sub" style="margin-top:.55em;font-size:clamp(13px,3.2vmin,18px);letter-spacing:.07em;opacity:0"></div>' +
    '</div>';
  host.appendChild(stage);
  ROOT.appendChild(host);

  var q = function (s) { return stage.querySelector(s); };
  var ring = q(".ma-ring"), prog = q(".ma-prog"), radius = q(".ma-radius"), dot = q(".ma-dot"),
      big = q(".ma-big"), sub = q(".ma-sub");

  var R = 42, C = 2 * Math.PI * R;
  ring.setAttribute("stroke-dasharray", C.toFixed(2)); ring.setAttribute("stroke-dashoffset", C.toFixed(2));
  prog.setAttribute("stroke-dasharray", C.toFixed(2)); prog.setAttribute("stroke-dashoffset", C.toFixed(2));

  // today's real fraction (wake 7 → sleep 19 — the widget's default), so the clock lands true
  var d = new Date(), mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, wM = 7 * 60, sM = 19 * 60;
  var isDay = mins >= wM && mins < sM;
  var FRAC = isDay ? (mins - wM) / (sM - wM) : (mins >= sM ? (mins - sM) : (mins + 1440 - sM)) / (1440 - (sM - wM));
  FRAC = Math.max(0.02, Math.min(1, FRAC));

  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeInOut = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var clamp01 = function (t) { return Math.max(0, Math.min(1, t)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ringPos = function (f) { var a = (-90 + f * 360) * Math.PI / 180; return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) }; };

  var M = { ignite: [0, 800], circle: [700, 2000], hold: [2000, 2500], rise: [2500, 2980], day: [2980, 3980], settle: [3980, 4380] };
  var T = M.settle[1], seg = function (t, k) { return clamp01((t - M[k][0]) / (M[k][1] - M[k][0])); };

  var start = null, raf = 0;
  function frame(now) {
    if (start == null) start = now; var t = now - start;

    // I. the point appears at the centre
    var ig = easeOut(seg(t, "ignite"));
    if (t < M.rise[0]) dot.setAttribute("r", (ig * 1.9).toFixed(2));

    // II. the line turns and draws the circle around the point
    var dp = seg(t, "circle"), dpe = easeInOut(dp);
    if (t >= M.circle[0]) {
      ring.setAttribute("stroke-opacity", "0.5");
      ring.setAttribute("stroke-dashoffset", (C * (1 - dpe)).toFixed(2));
      radius.setAttribute("stroke-opacity", (Math.sin(Math.min(dp, 1) * Math.PI) * 0.45).toFixed(3));
      var pr = ringPos(dpe); radius.setAttribute("x2", pr.x.toFixed(2)); radius.setAttribute("y2", pr.y.toFixed(2));
    }

    // III. the point rises to the crown; the circle settles into the faint track
    if (t >= M.rise[0]) {
      var rp = easeInOut(seg(t, "rise"));
      ring.setAttribute("stroke-opacity", lerp(0.5, 0.13, rp).toFixed(3));
      radius.setAttribute("stroke-opacity", (0.45 * (1 - rp)).toFixed(3));
      var top = ringPos(0);
      dot.setAttribute("cx", lerp(50, top.x, rp).toFixed(2)); dot.setAttribute("cy", lerp(50, top.y, rp).toFixed(2));
      dot.setAttribute("r", lerp(1.9, 3.3, rp).toFixed(2));
    }

    // the sun rides forward to now; the arc traces the day; the measure resolves
    if (t >= M.day[0]) {
      var yp = easeInOut(seg(t, "day")), f = FRAC * yp, p = ringPos(f);
      dot.setAttribute("cx", p.x.toFixed(2)); dot.setAttribute("cy", p.y.toFixed(2)); dot.setAttribute("r", isDay ? "3.3" : "2.7");
      prog.setAttribute("stroke-opacity", isDay ? ".55" : ".3");
      prog.setAttribute("stroke-dashoffset", (C * (1 - f)).toFixed(2));
      big.style.opacity = yp.toFixed(2); sub.style.opacity = (yp * 0.6).toFixed(2);
      big.textContent = Math.round(FRAC * 100 * yp) + "%"; sub.textContent = isDay ? "of your day" : "of the night";
    }

    if (t < T) raf = requestAnimationFrame(frame); else settle();
  }

  function settle() {
    var p = ringPos(FRAC);
    ring.setAttribute("stroke-opacity", "0.13"); ring.setAttribute("stroke-dashoffset", "0");
    radius.setAttribute("stroke-opacity", "0");
    prog.setAttribute("stroke-opacity", isDay ? ".55" : ".3"); prog.setAttribute("stroke-dashoffset", (C * (1 - FRAC)).toFixed(2));
    dot.setAttribute("cx", p.x.toFixed(2)); dot.setAttribute("cy", p.y.toFixed(2)); dot.setAttribute("r", isDay ? "3.3" : "2.7");
    big.style.opacity = "1"; sub.style.opacity = "0.6"; big.textContent = Math.round(FRAC * 100) + "%";
    sub.textContent = isDay ? "of your day" : "of the night";
    // hold the finished clock a beat, then cross-dissolve to reveal the desktop, and remove
    setTimeout(function () {
      host.style.opacity = "0";
      setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, 760);
    }, 520);
  }

    requestAnimationFrame(frame);
  }  // end play()

  // ── decide WHEN to play ───────────────────────────────────────────────────────────────────────────
  // 1) ?arrival=1 replay hatch → now.  2) native handoff: sddm.enterShell() set a one-shot flag before
  //    navigating here → now.  3) web (single-page messenger): no navigation — the login overlay
  //    (#holo-login) unfogs then is removed to reveal Home; play the instant auth succeeds, once.
  var nativeArrival = false;
  try { if (sessionStorage.getItem(FLAG) === "1") { sessionStorage.removeItem(FLAG); nativeArrival = true; } } catch (e) {}
  if (replay || nativeArrival) { play(); return; }

  function watchLogin() {
    var ov = document.getElementById("holo-login");
    if (!ov) return false;
    var fire = function () { play(); };
    try {
      var mo = new MutationObserver(function () {
        if ((ov.classList && ov.classList.contains("unfog")) || !ov.isConnected) { mo.disconnect(); fire(); }
      });
      mo.observe(ov, { attributes: true, attributeFilter: ["class"] });
      var par = ov.parentNode || document.documentElement;   // its removal is a childList change on the parent
      var mo2 = new MutationObserver(function () { if (!ov.isConnected) { mo2.disconnect(); fire(); } });
      mo2.observe(par, { childList: true });
    } catch (e) {}
    return true;
  }
  if (!watchLogin()) {
    // #holo-login not mounted yet — wait for it to appear, then watch it (bounded, so an already-authed
    // instant Home never leaves an observer running).
    try {
      var boot = new MutationObserver(function () { if (watchLogin()) boot.disconnect(); });
      boot.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(function () { try { boot.disconnect(); } catch (e) {} }, 15000);
    } catch (e) {}
  }
})();
