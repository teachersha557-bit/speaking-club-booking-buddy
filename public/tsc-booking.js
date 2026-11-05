/*!
 * Teacher Sha Speaking Club — booking connector for the existing Netlify website.
 * Adds NO styling of its own beyond small neutral defaults (class names tsc-*),
 * so the website's design stays exactly as it is.
 *
 * Include on the public site (replace ENGINE with your engine site address):
 *   <script src="https://ENGINE/tsc-booking.js" defer></script>
 *
 * Registration form:  TSC.attachForm(document.querySelector("#your-form"), { fields: {...} })
 * Booking page:       <div data-tsc-status></div>   (auto-filled on /booking/TSC-XXXXXX pages)
 * Low-level API:      TSC.createBooking(data), TSC.getBooking(ref), TSC.getAvailability()
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var ENGINE = ((script && script.getAttribute("data-engine")) || (script && new URL(script.src).origin) || "").replace(/\/+$/, "");
  var REF_RE = /^TSC-[A-Z0-9]{6}$/;
  var MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];

  function fmtDate(d) {
    return "Selasa, " + Number(d.slice(8, 10)) + " " + MS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4);
  }
  function request(path, opts) {
    return fetch(ENGINE + path, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "SERVER_ERROR" }; });
    }, function () { return { ok: false, error: "NETWORK" }; });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  var MESSAGES = {
    FULL: "Maaf, kelas pada tarikh berikut sudah penuh (maksimum 10 pelajar): ",
    ALREADY_BOOKED: "Anda sudah mempunyai tempahan untuk tarikh-tarikh ini. Rujukan: ",
    INVALID_DATE: "Tarikh mula tidak sah. Sila pilih hari Selasa yang akan datang.",
    INVALID_INPUT: "Sila semak nama, emel dan nombor WhatsApp anda.",
    RATE_LIMIT: "Terlalu banyak cubaan. Sila cuba lagi dalam sejam.",
    NETWORK: "Tiada sambungan. Sila cuba lagi.",
    SERVER_ERROR: "Maaf, ada masalah teknikal. Sila cuba lagi sebentar lagi.",
  };
  function errorText(r) {
    var base = MESSAGES[r && r.error] || MESSAGES.SERVER_ERROR;
    if (r && r.error === "FULL" && r.full_dates) return base + r.full_dates.map(fmtDate).join(", ");
    if (r && r.error === "ALREADY_BOOKED" && r.reference) return base + r.reference;
    return base;
  }

  var TSC = {
    engine: ENGINE,
    formatDate: fmtDate,
    errorText: errorText,

    /** data: { name, email, whatsapp, whatsapp_consent, start ("YYYY-MM-DD" or "YYYYMMDD"), reference? } */
    createBooking: function (data) {
      return request("/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    getBooking: function (ref) {
      return request("/api/public/bookings/" + encodeURIComponent(ref));
    },
    getAvailability: function () {
      return request("/api/public/availability");
    },

    /**
     * Sends the site's existing registration form to the engine, then goes to the
     * existing booking page (/booking/TSC-XXXXXX?s=YYYYMMDD) returned by the engine.
     * options.fields maps engine fields to your form's input names, e.g.
     *   { name: "nama", email: "email", whatsapp: "phone", start: "tarikh", whatsapp_consent: "consent", reference: "ref" }
     * options.onSuccess(result) / options.onError(message, result) override the default behaviour.
     * The form's normal Netlify Forms submission can be kept as a backup copy (options.keepNetlifySubmit).
     */
    attachForm: function (form, options) {
      if (!form) return;
      options = options || {};
      var f = Object.assign({ name: "name", email: "email", whatsapp: "whatsapp", start: "start", whatsapp_consent: "whatsapp_consent", reference: "reference" }, options.fields || {});
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var get = function (k) { var v = fd.get(f[k]); return v == null ? "" : String(v); };
        var consentEl = form.elements[f.whatsapp_consent];
        var payload = {
          name: get("name"), email: get("email"), whatsapp: get("whatsapp"), start: get("start"),
          whatsapp_consent: consentEl && "checked" in consentEl ? !!consentEl.checked : get("whatsapp_consent"),
        };
        var ref = get("reference").toUpperCase();
        if (REF_RE.test(ref)) payload.reference = ref;
        var btn = form.querySelector("[type=submit]");
        if (btn) btn.disabled = true;
        TSC.createBooking(payload).then(function (r) {
          if (btn) btn.disabled = false;
          if (!r || !r.ok) {
            var msg = errorText(r);
            if (options.onError) options.onError(msg, r); else alert(msg);
            return;
          }
          if (options.keepNetlifySubmit) {
            var copy = new URLSearchParams(new FormData(form));
            copy.set(f.reference, r.reference);
            fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: copy.toString() }).catch(function () {});
          }
          if (options.onSuccess) options.onSuccess(r);
          else window.location.href = "/booking/" + r.reference + "?s=" + r.start_date.replace(/-/g, "");
        });
      });
    },

    /** Renders live booking status (dates, countdown, pay button, confirmation) into el. */
    mountStatus: function (el, ref) {
      if (!el || !REF_RE.test(ref)) return;
      var timer = null, poll = null;
      function render(r) {
        if (!r || !r.ok) {
          el.innerHTML = '<p class="tsc-error">' + esc(r && r.error === "NOT_FOUND" ? "Tempahan tidak dijumpai: " + ref : errorText(r)) + "</p>";
          return;
        }
        var b = r.booking;
        var dates = '<ol class="tsc-dates">' + b.dates.map(function (d) { return "<li>" + esc(fmtDate(d)) + ", 8:00–9:00 PM</li>"; }).join("") + "</ol>";
        var html = '<p class="tsc-ref">Rujukan tempahan: <strong>' + esc(b.reference) + "</strong></p>" + dates;
        if (b.status === "confirmed") {
          html += '<p class="tsc-ok"><strong>✅ Bayaran disahkan. Tempahan anda telah disahkan!</strong><br>Emel pengesahan dengan 4 pautan Google Meet (satu untuk setiap Selasa) telah dihantar. Sila semak inbox / spam.</p>';
          stop();
        } else if (b.status === "held" && b.payment_url) {
          html += '<p class="tsc-hold">Tempat anda ditahan selama <strong class="tsc-countdown"></strong>. Sila bayar RM49 (bayaran sekali untuk 4 kelas, bukan langganan).</p>';
          if (b.payment_mode === "form") html += '<p class="tsc-note">Penting: masukkan rujukan <strong>' + esc(b.reference) + "</strong> dalam ruangan <em>Booking Reference</em> borang BCL dan gunakan emel yang sama.</p>";
          html += '<p><a class="tsc-pay" href="' + esc(b.payment_url) + '" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#e8453c;color:#fff;font-weight:bold;text-decoration:none">Bayar RM49 di BCL</a></p>';
        } else if (b.status === "needs_resolution") {
          html += '<p class="tsc-note">Bayaran anda diterima dan sedang disemak oleh Teacher Sha. Anda akan dihubungi tidak lama lagi.</p>';
          stop();
        } else if (b.status === "cancelled") {
          html += '<p class="tsc-error">Tempahan ini telah dibatalkan.</p>';
          stop();
        } else {
          html += '<p class="tsc-error">Masa tahanan 20 minit telah tamat. Jika anda sudah membayar, jangan risau — bayaran akan disemak secara automatik. Jika belum, sila buat tempahan baru.</p>';
        }
        el.innerHTML = html;
        if (b.hold_expires_at) countdown(new Date(b.hold_expires_at).getTime());
      }
      function countdown(until) {
        clearInterval(timer);
        var tick = function () {
          var s = Math.max(0, Math.round((until - Date.now()) / 1000));
          var c = el.querySelector(".tsc-countdown");
          if (c) c.textContent = Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
          if (s === 0) { clearInterval(timer); load(); }
        };
        tick();
        timer = setInterval(tick, 1000);
      }
      function stop() { clearInterval(poll); poll = null; }
      function load() { TSC.getBooking(ref).then(render); }
      load();
      poll = setInterval(load, 15000);
    },
  };

  window.TSC = TSC;

  // Auto-mount on the existing booking page: /booking/TSC-XXXXXX?s=YYYYMMDD
  function auto() {
    var m = window.location.pathname.match(/\/booking\/(TSC-[A-Z0-9]{6})/i);
    var el = document.querySelector("[data-tsc-status]");
    if (m && el) TSC.mountStatus(el, m[1].toUpperCase());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto);
  else auto();
})();
