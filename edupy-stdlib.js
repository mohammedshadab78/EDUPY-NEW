// edupy-stdlib.js  (fixed & hardened)
// Adds common Python-like stdlib helpers to EduPy runtime.
// - Exposes: math, random (seedable), datetime, range, open (shim), dict helpers,
//   string startswith/endswith/join_py, list helpers (append, insert, remove, pop_py, reverse_py, shuffle).
// - Auto-registers with common global scopes used by EduPy; retries a few times if runtime initializes later.

(function () {
  "use strict";

  // ---------------- PRNG (seedable) ----------------
  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t |= 0;
      t = (t + 0x6D2B79F5) | 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // mutable PRNG container so we can re-seed
  const _prngContainer = {
    _fn: mulberry32((Date.now() & 0xffffffff) >>> 0),
    random: function () {
      return this._fn();
    },
    seed: function (s) {
      // Accept number or string
      let seedVal;
      if (typeof s === "number") seedVal = s | 0;
      else if (typeof s === "string") {
        seedVal = 0;
        for (let i = 0; i < s.length; i++) seedVal = (seedVal * 31 + s.charCodeAt(i)) | 0;
      } else {
        seedVal = (Date.now() & 0xffffffff) | 0;
      }
      this._fn = mulberry32(seedVal >>> 0);
    },
  };

  // ---------------- Math ----------------
  const math = {
    pi: Math.PI,
    e: Math.E,
    sqrt: (x) => Math.sqrt(x),
    pow: (a, b) => Math.pow(a, b),
    sin: (x) => Math.sin(x),
    cos: (x) => Math.cos(x),
    tan: (x) => Math.tan(x),
    abs: (x) => Math.abs(x),
    floor: (x) => Math.floor(x),
    ceil: (x) => Math.ceil(x),
    // Python-style round(x, ndigits=None)
    round: (x, ndigits) => {
      if (ndigits === undefined || ndigits === null) return Math.round(x);
      const p = Math.pow(10, ndigits);
      return Math.round(x * p) / p;
    },
    max: (...a) => Math.max(...a),
    min: (...a) => Math.min(...a),
  };

  // ---------------- Random ----------------
  const random = {
    random: () => _prngContainer.random(),
    randint: (a, b) => {
      a = Math.floor(a);
      b = Math.floor(b);
      if (b < a) {
        const tmp = a;
        a = b;
        b = tmp;
      }
      return Math.floor(_prngContainer.random() * (b - a + 1)) + a;
    },
    choice: (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr[Math.floor(_prngContainer.random() * arr.length)];
    },
    shuffle: (arr) => {
      if (!Array.isArray(arr)) return arr;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(_prngContainer.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
    seed: (s) => _prngContainer.seed(s),
  };

  // ---------------- Datetime (light) ----------------
  const datetime = {
    now: () => {
      const d = new Date();
      return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes(),
        second: d.getSeconds(),
        iso: () => d.toISOString(),
        toString: () => d.toString(),
      };
    },
    // fmt: %Y %m %d %H %M %S
    strftime: function (fmt, dateObj) {
      const d = dateObj instanceof Date ? dateObj : new Date();
      return fmt
        .replace(/%Y/g, String(d.getFullYear()))
        .replace(/%m/g, String(d.getMonth() + 1).padStart(2, "0"))
        .replace(/%d/g, String(d.getDate()).padStart(2, "0"))
        .replace(/%H/g, String(d.getHours()).padStart(2, "0"))
        .replace(/%M/g, String(d.getMinutes()).padStart(2, "0"))
        .replace(/%S/g, String(d.getSeconds()).padStart(2, "0"));
    },
  };

  // ---------------- Mini file API (browser friendly) ----------------
  window.__edupy_files = window.__edupy_files || {};

  function saveTextFile(filename, text) {
    try {
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "file.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("saveTextFile failed:", e);
    }
  }

  function readFileFromUser(callback) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "*/*";
    inp.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return callback(null);
      const reader = new FileReader();
      reader.onload = () => callback(reader.result);
      reader.onerror = () => callback(null);
      reader.readAsText(f);
    };
    // trigger file picker
    inp.click();
  }

  function openShim(filename, mode) {
    mode = mode || "r";
    if (mode === "r") {
      return {
        read: function (cb) {
          // callback receives data or null
          readFileFromUser(function (data) {
            try {
              cb(data);
            } catch (e) {
              console.warn("openShim read callback error:", e);
            }
          });
        },
      };
    } else if (mode === "w" || mode === "a") {
      return {
        write: function (text) {
          saveTextFile(filename || "file.txt", text);
        },
      };
    } else {
      throw new Error("openShim: unsupported mode " + mode);
    }
  }

  // ---------------- Dict helpers ----------------
  function dict_items(obj) {
    if (!obj || typeof obj !== "object") return [];
    return Object.keys(obj).map((k) => [k, obj[k]]);
  }
  function dict_keys(obj) {
    if (!obj || typeof obj !== "object") return [];
    return Object.keys(obj);
  }
  function dict_values(obj) {
    if (!obj || typeof obj !== "object") return [];
    return Object.keys(obj).map((k) => obj[k]);
  }
  function dict_get(obj, key, def) {
    if (!obj || typeof obj !== "object") return def === undefined ? null : def;
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : (def === undefined ? null : def);
  }
  function dict_update(obj, other) {
    if (!obj || typeof obj !== "object") return obj;
    if (!other || typeof other !== "object") return obj;
    Object.keys(other).forEach((k) => (obj[k] = other[k]));
    return obj;
  }

  // ---------------- Range ----------------
  function range_py(start, stop, step) {
    if (stop === undefined) {
      // range(n)
      stop = start === undefined ? 0 : start;
      start = 0;
    }
    step = step === undefined ? 1 : step;
    const out = [];
    if (step > 0) {
      for (let i = start; i < stop; i += step) out.push(i);
    } else if (step < 0) {
      for (let i = start; i > stop; i += step) out.push(i);
    }
    return out;
  }

  // ---------------- String helpers ----------------
  if (!String.prototype.startswith) {
    Object.defineProperty(String.prototype, "startswith", {
      value: function (prefix) {
        return this.indexOf(prefix) === 0;
      },
      configurable: true,
    });
  }
  if (!String.prototype.endswith) {
    Object.defineProperty(String.prototype, "endswith", {
      value: function (suffix) {
        if (suffix.length > this.length) return false;
        return this.slice(this.length - suffix.length) === suffix;
      },
      configurable: true,
    });
  }
  if (!String.prototype.join_py) {
    Object.defineProperty(String.prototype, "join_py", {
      value: function (arr) {
        if (!Array.isArray(arr)) return String(arr);
        return arr.join(this);
      },
      configurable: true,
    });
  }

  // ---------------- List helpers (Array) ----------------
  try {
    if (!Array.prototype.append)
      Object.defineProperty(Array.prototype, "append", {
        value: function (v) {
          this.push(v);
        },
        configurable: true,
      });
    if (!Array.prototype.insert)
      Object.defineProperty(Array.prototype, "insert", {
        value: function (i, v) {
          this.splice(i, 0, v);
        },
        configurable: true,
      });
    if (!Array.prototype.remove)
      Object.defineProperty(Array.prototype, "remove", {
        value: function (v) {
          const i = this.indexOf(v);
          if (i === -1) throw new Error("ValueError: list.remove(x): x not in list");
          this.splice(i, 1);
        },
        configurable: true,
      });
    if (!Array.prototype.pop_py)
      Object.defineProperty(Array.prototype, "pop_py", {
        value: function (i) {
          if (i === undefined) return this.pop();
          return this.splice(i, 1)[0];
        },
        configurable: true,
      });
    if (!Array.prototype.reverse_py)
      Object.defineProperty(Array.prototype, "reverse_py", {
        value: function () {
          return this.reverse();
        },
        configurable: true,
      });
    if (!Array.prototype.shuffle)
      Object.defineProperty(Array.prototype, "shuffle", {
        value: function () {
          return random.shuffle(this);
        },
        configurable: true,
      });
  } catch (e) {
    // ignore if environment prevents prototype changes
    console.warn("edupy-stdlib: couldn't add Array prototypes:", e);
  }

  // ---------------- Register / expose ----------------
  function registerStdlib(target) {
    // target is the interpreter's global object (if present)
    target = target || (window && (window.globalScope || window.__edupy_builtins || (window.EduPy && window.EduPy.globalScope)));
    if (!target) {
      // fallback create builtins object
      window.__edupy_builtins = window.__edupy_builtins || {};
      target = window.__edupy_builtins;
    }

    // Do not overwrite existing implementations if present; fill missing ones
    if (!target.math) target.math = math;
    else {
      // ensure math.round exists
      if (!target.math.round) target.math.round = math.round;
    }
    if (!target.random) target.random = random;
    if (!target.datetime) target.datetime = datetime;
    if (!target.open) target.open = openShim;
    if (!target.saveTextFile) target.saveTextFile = saveTextFile;
    if (!target.readFileFromUser) target.readFileFromUser = readFileFromUser;

    // dict helpers
    if (!target.dict_items) target.dict_items = dict_items;
    if (!target.dict_keys) target.dict_keys = dict_keys;
    if (!target.dict_values) target.dict_values = dict_values;
    if (!target.dict_get) target.dict_get = dict_get;
    if (!target.dict_update) target.dict_update = dict_update;

    // range
    if (!target.range) target.range = range_py;

    // mark
    target.__edupy_stdlib_registered = true;

    return target;
  }

  // ---------------- Auto-register strategy ----------------
  // Try immediate register, then retry a few times (in case EduPy creates its global later).
  try {
    registerStdlib();
  } catch (e) {
    // ignore
  }

  // If EduPy creates its own global scope later, attempt to register again.
  let attempts = 0;
  const maxAttempts = 10;
  const retryInterval = 400; // ms

  const retryTimer = setInterval(function () {
    attempts++;
    try {
      // prefer the runtime global if present
      const runtimeGlobal = window.globalScope || window.__edupy_builtins || (window.EduPy && window.EduPy.globalScope);
      if (runtimeGlobal) {
        registerStdlib(runtimeGlobal);
      }
    } catch (e) {
      // swallow
    }
    if (attempts >= maxAttempts) {
      clearInterval(retryTimer);
    }
  }, retryInterval);

  // Expose API for manual use
  window.EduPyStdLib = window.EduPyStdLib || {};
  window.EduPyStdLib.register = registerStdlib;
  window.EduPyStdLib.math = math;
  window.EduPyStdLib.random = random;
  window.EduPyStdLib.datetime = datetime;
  window.EduPyStdLib.open = openShim;

  // Friendly console notice (only if devtools open)
  if (typeof console !== "undefined" && console.log) {
    console.log("edupy-stdlib: registered (attempts will continue briefly if EduPy init is late)");
  }
})();

