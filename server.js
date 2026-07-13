// server.js
// Karma Protection v6.2 - Standalone Web Server
// Features: Advanced VM, Anti-Dump, HWID 24h Cooldown, Key System, Obfuscator

require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const {
  DATABASE_PATH = './data.sqlite',
  PUBLIC_BASE_URL = 'https://your-render-app.onrender.com',
  OBFUSCATOR_API_URL = 'https://luarmor-bot-1-0yt4.onrender.com',
  SESSION_SECRET,
  OWNER_ID = '1207803375807373415',
  MAX_SCRIPTS_PER_USER = '5'
} = process.env;

const SESSION_SIGNING_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_WEB_SCRIPTS_PER_USER = parseInt(MAX_SCRIPTS_PER_USER, 10) || 5;

// ---------------- Database ----------------
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_secret_hash TEXT NOT NULL,
  api_secret_preview TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  discord_user_id TEXT,
  hwid TEXT,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT,
  last_reset_at TEXT,
  reset_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hosted_scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  source_code TEXT,
  linked_script_id TEXT,
  obfuscated INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id TEXT NOT NULL,
  license_key TEXT,
  hwid TEXT,
  ip TEXT,
  executor TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS website_users (
  id TEXT PRIMARY KEY,
  username TEXT,
  global_name TEXT,
  avatar TEXT,
  display_username TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  script_quota INTEGER NOT NULL DEFAULT 5,
  last_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banned_hwids (
  hwid TEXT PRIMARY KEY,
  reason TEXT,
  banned_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------------- Helpers ----------------
function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function makeKey(prefix = 'PS') {
  const raw = crypto.randomBytes(18).toString('base64url').toUpperCase();
  return `${prefix}-${raw.match(/.{1,6}/g).join('-')}`;
}

function makeId(prefix = 'script') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function addDays(days) {
  if (!days || days <= 0) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function isExpired(expiresAt) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 3000}`;
}

function makeLoaderSnippet(scriptId) {
  const baseUrl = publicBaseUrl();
  return `loadstring(game:HttpGet("${baseUrl}/loadstring/${scriptId}"))("${scriptId}")`;
}

function makeProtectedLoader(rawUrl, scriptId) {
  const home = publicBaseUrl();
  
  return `--[[
    Karma Protection VM Loader v6.2
    Secure Instruction Stream - Anti-Dump Hardened
]]
return (function(_sid, ...)
  local _G = getfenv(0) or _G
  local _type, _pcall, _tostr, _byte, _error = type, pcall, tostring, string.byte, error
  local _load = loadstring or load
  local _warn = (typeof(warn) == "function") and warn or print
  local _setclip = (typeof(setclipboard) == "function") and setclipboard or nil
  
  local _iqru = ${JSON.stringify(home)}
  local _30lq = ${JSON.stringify(rawUrl)}
  local _r0wo = { script_id = ${JSON.stringify(scriptId)} }
  
  local function _gat3(m)
    if _setclip then _pcall(_setclip, _iqru) end
    _pcall(_warn, "[Karma VM] " .. _tostr(m) .. " | " .. _iqru)
    while true do _error(m, 0) end
  end

  local function _xm17(f, ...)
    local ok, r = _pcall(f, ...)
    return ok and r or nil
  end

  local function _r8wq(v)
    local s, n = _tostr(v), 2166136261
    for i = 1, #s do
      n = bit32.bxor(n, _byte(s, i))
      n = (n * 16777619) % 4294967296
    end
    return n
  end

  -- VM State
  local _gqej = 1
  local _bmcv = getfenv(1)
  
  -- Instruction Stream (Encoded)
  -- 1: PULSE, 2: CHECK_ENV, 3: CHECK_HOOKS, 4: CHECK_GAME, 5: FETCH, 6: EXECUTE
  local _y4m2 = {1, 2, 3, 4, 5, 7, 8, 1, 3, 6}
  
  local _rrw1 = {
    [1] = function() -- PULSE / TAMPER CHECK
      local _raw = { _K = "Karma Protection" }
      local _sig = { _K = 2947889846 }
      for k, v in pairs(_sig) do
        if _r8wq(_raw[k]) ~= v then _gat3("tamper detected") end
      end
    end,
    [2] = function() -- CHECK_ENV
      if typeof(getfenv) == "function" then
        local e = _xm17(getfenv, 1)
        if _type(e) == "table" then
          local s = { "hookfunction", "newcclosure", "syn", "fluxus" }
          for _, k in ipairs(s) do
            if e[k] ~= nil and rawget(_G, k) == nil then _gat3("env logger: " .. k) end
          end
        end
      end
    end,
    [3] = function() -- CHECK_HOOKS
      local c = {tostring, type, pcall, pairs, _load}
      for _, f in ipairs(c) do
        if typeof(f) ~= "function" then _gat3("hook detected") end
        if typeof(islclosure) == "function" and islclosure(f) then _gat3("hooked closure") end
      end
    end,
    [4] = function() -- CHECK_GAME
      local ok, info = _pcall(function() return game:GetService("MarketplaceService"):GetProductInfo(game.PlaceId) end)
      if ok and _type(info) == "table" and _type(info.Name) ~= "string" then _gat3("game tamper") end
    end,
    [5] = function() -- FETCH
      local function _g(u)
        if game and game.HttpGet then
          local r = _xm17(function() return game:HttpGet(u) end)
          if _type(r) == "string" and #r > 0 then return r end
        end
        local req = (typeof(syn) == "table" and syn.request) or (typeof(http_request) == "function" and http_request) or (typeof(request) == "function" and request)
        if _type(req) == "function" then
          local res = _xm17(req, { Url = u, Method = "GET" })
          if _type(res) == "table" then return res.Body or res.body end
        end
        return nil
      end
      _r0wo.src = _g(_30lq)
      if _type(_r0wo.src) ~= "string" then _gat3("fetch failed") end
    end,
    
    [7] = function() -- LOGGING
      local function _l(u, d)
        local req = (typeof(syn) == "table" and syn.request) or (typeof(http_request) == "function" and http_request) or (typeof(request) == "function" and request)
        if _type(req) == "function" then
          _pcall(req, {
            Url = u,
            Method = "POST",
            Headers = { ["Content-Type"] = "application/json" },
            Body = game:GetService("HttpService"):JSONEncode(d)
          })
        end
      end
      local d = {
        script_id = _r0wo.script_id or "unknown",
        key = _G.KarmaKey or "none",
        hwid = (typeof(gethwid) == "function" and gethwid()) or "none",
        executor = (typeof(identifyexecutor) == "function" and identifyexecutor()) or "unknown"
      }
      _l(_iqru .. "/api/log-execution", d)
    end,

    [8] = function() -- SOURCE ANTI-TAMPER
      local function _sc(s)
        local c = 0
        if s then
          for i = 1, #s do
            c = (c + _byte(s, i) * i) % 4294967295
          end
        end
        return c
      end
      local src1 = debug.getinfo(1).source
      local sum1 = _sc(src1)
      if typeof(task) == "table" and task.wait then task.wait(0.1) end
      local src2 = debug.getinfo(1).source
      local sum2 = _sc(src2)
      if sum1 ~= sum2 or sum1 == 0 then
        _gat3("source tampering detected")
      end
    end,

    [6] = function(...) -- EXECUTE
      if _type(_load) ~= "function" then _gat3("no load") end
      local ok, f = _pcall(_load, _r0wo.src, "KarmaVM")
      if not ok or _type(f) ~= "function" then _gat3("load failed") end
      return f(...)
    end
  }

  -- Interpreter Loop
  while _gqej <= #_y4m2 do
    local _szk7 = _y4m2[_gqej]
    local _ci83 = _rrw1[_szk7]
    if _szk7 == 6 then
      return _ci83(...)
    else
      _ci83()
    end
    _gqej = _gqej + 1
  end
end)(...)
`;
}

async function callObfuscator(luaCode, level = 'standard') {
  const selected = String(level || 'standard').toLowerCase();
  const apiUrl = (OBFUSCATOR_API_URL || 'https://luarmor-bot-1-0yt4.onrender.com').replace(/\/$/, '') + '/api/obfuscate';

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(luaCode || ''), level: selected })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`Obfuscator API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.ok || typeof data.obfuscated !== 'string') {
    throw new Error(`Obfuscator API returned an error: ${data.error || JSON.stringify(data).slice(0, 200)}`);
  }

  return data.obfuscated;
}

// ---------------- Express App ----------------
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

// ---------------- Routes ----------------
app.get('/', (req, res) => {
  res.send(`
    <!doctype html>
    <html><head><title>Karma Protection v6.2</title>
    <style>
      body{margin:0;background:#030303;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh;text-align:center}
      .card{max-width:600px;padding:48px;border:1px solid #333;border-radius:28px;background:#0a0a0a}
      h1{font-size:48px;letter-spacing:-.04em}
      .gold{color:#d4af37}
      a{display:inline-block;margin-top:20px;padding:12px 28px;border:1px solid #d4af37;border-radius:999px;color:#fff;text-decoration:none;font-weight:700}
      a:hover{background:#d4af37;color:#000}
      .btn-accent{background:#d4af37;color:#000;border:none}
    </style>
    </head><body>
    <div class="card">
      <h1>Karma <span class="gold">Protection v6.2</span></h1>
      <p>Protect your Lua scripts with HWID-locked keys, obfuscation, and secure delivery.</p>
      <a href="/dashboard">Enter Dashboard</a>
    </div>
    </body></html>
  `);
});

app.get('/health', (req, res) => res.json({ ok: true, name: 'Karma Protection v6.2' }));

app.get('/dashboard', (req, res) => {
  const tab = req.query.tab || 'overview';
  const scripts = db.prepare('SELECT * FROM hosted_scripts ORDER BY created_at DESC LIMIT 500').all();
  const totalScripts = db.prepare('SELECT COUNT(*) as c FROM hosted_scripts').get().c;
  const totalKeys = db.prepare('SELECT COUNT(*) as c FROM licenses').get().c;
  const totalLoads = db.prepare('SELECT COUNT(*) as c FROM execution_logs').get().c;
  
  const scriptLinks = scripts.length
    ? scripts.map(s => `<a class="scriptLink ${req.query.script === s.id ? 'active' : ''}" href="/dashboard?tab=scripts&script=${s.id}"><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? 'Obfuscated' : 'Plain'}</small></a>`).join('')
    : `<p class="muted pad">No scripts yet.</p>`;

  let content = '';
  
  if (tab === 'overview') {
    content = `
      <div class="card heroCard">
        <p class="eyebrow">Overview</p>
        <h2>Karma Protection v6.2</h2>
        <p class="muted">Advanced VM protection, anti-dump hardening, and secure script delivery.</p>
        <div class="stats">
          <div class="stat"><div class="num">${totalScripts}</div><span>Scripts</span></div>
          <div class="stat"><div class="num">${totalKeys}</div><span>Keys</span></div>
          <div class="stat"><div class="num">${totalLoads}</div><span>Loads</span></div>
        </div>
        <div class="anime"></div>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Scripts</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-accent">${totalScripts}</p>
        </div>
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Keys</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-txt">${totalKeys}</p>
        </div>
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Loads</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-txt">${totalLoads}</p>
        </div>
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Storage</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-txt">${scripts.length}</p>
        </div>
      </div>
      <div class="filter-bar">
        <a href="/dashboard?tab=scripts">Scripts</a>
        <a href="/dashboard?tab=keys">Keys</a>
        <a href="/dashboard?tab=obfuscate">Obfuscator</a>
      </div>
    `;
  } else if (tab === 'scripts') {
    const selectedId = String(req.query.script || '');
    const selected = selectedId ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(selectedId) : (scripts[0] || null);
    
    content = `
      <div class="card"><p class="eyebrow">Scripts</p><h2>Manage your scripts</h2>
      <p class="muted">${scripts.length} scripts stored. Click a script to view or edit.</p>
      ${scriptLinks}
      </div>
      ${selected ? `
        <div class="card">
          <div class="cardHead"><div><p class="eyebrow">Selected Script</p><h2>${escapeHtml(selected.name)}</h2><p class="muted">${selected.obfuscated ? 'Obfuscated build' : 'Plain build'}</p></div></div>
          <h3>Loadstring</h3>
          <code class="block">${makeLoaderSnippet(selected.id)}</code>
          <h3>Edit Script</h3>
          <form method="post" action="/dashboard/scripts/${selected.id}/update">
            <label>Script name</label>
            <input name="name" maxlength="80" value="${escapeHtml(selected.name)}" required>
            <label>Source Code</label>
            <textarea name="code" maxlength="4000" required>${escapeHtml(selected.source_code || selected.code)}</textarea>
            <label class="check"><input type="checkbox" name="obfuscate" value="true" ${selected.obfuscated ? 'checked' : ''}> Obfuscate on save</label>
            <label>Obfuscation level</label>
            <select name="level">
              <option value="light">Light</option>
              <option value="standard" ${selected.obfuscated ? 'selected' : ''}>Standard</option>
              <option value="max">Maximum</option>
              <option value="vm">VM Protected</option>
            </select>
            <div class="buttonRow"><button type="submit">Save Script</button></div>
          </form>
        </div>
      ` : `<div class="card"><h2>No script selected</h2><p class="muted">Click a script from the list above or create a new one below.</p></div>`}
      <div class="card"><p class="eyebrow">Add Script</p><h2>Upload new script</h2>
      <form method="post" action="/dashboard/scripts" enctype="multipart/form-data">
        <label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required>
        <label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain">
        <label>Source Code</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea>
        <label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before saving</label>
        <label>Obfuscation level</label>
        <select name="level">
          <option value="light">Light</option>
          <option value="standard" selected>Standard</option>
          <option value="max">Maximum</option>
          <option value="vm">VM Protected</option>
        </select>
        <button type="submit">Save Script</button>
      </form></div>
    `;
  } else if (tab === 'keys') {
    const keys = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC LIMIT 50').all();
    content = `
      <div class="card"><p class="eyebrow">Keys</p><h2>License Keys</h2>
      <p class="muted">${keys.length} keys generated.</p>
      <form method="post" action="/dashboard/keys">
        <label>Script ID</label><input name="script_id" placeholder="script_xxxxxxxx">
        <label>Days until expiry (0 = lifetime)</label><input name="days" type="number" value="30" min="0" max="3650">
        <label>Quantity</label><input name="quantity" type="number" value="1" min="1" max="20">
        <button type="submit">Generate Keys</button>
      </form>
      <h3>Recent Keys</h3>
      ${keys.map(k => `<div class="row"><b>${escapeHtml(k.license_key)}</b><small>${k.expires_at || 'Lifetime'} · ${k.revoked ? 'Revoked' : 'Active'}${k.hwid ? ' · HWID locked' : ''}</small></div>`).join('') || '<p class="muted">No keys yet.</p>'}
      </div>`;
  } else if (tab === 'obfuscate') {
    content = `
      <div class="card"><p class="eyebrow">Obfuscator</p><h2>Protect Lua source</h2>
      <p class="muted">Multi-layer obfuscation with VM protection, anti-tamper checks, and encoded payloads.</p>
      <form method="post" action="/dashboard/obfuscate">
        <label>Filename</label><input name="filename" value="obfuscated.lua">
        <label>Lua source</label><textarea id="codeBox" name="code" maxlength="4000" placeholder='print("protect me")' required></textarea>
        <label>Obfuscation level</label>
        <select name="level">
          <option value="light">Light</option>
          <option value="standard" selected>Standard</option>
          <option value="max">Maximum</option>
          <option value="vm">VM Protected</option>
        </select>
        <div class="buttonRow"><button type="submit">Obfuscate</button>
        <a class="btn dark" href="/dashboard?tab=scripts">Scripts</a></div>
      </form>
      <div class="featureGrid">
        <div>Anti-tamper checksum</div>
        <div>Anti-Dump Hardening</div>
        <div>Rolling XOR byte encoding</div>
        <div>Decoy layer for dumps</div>
        <div>Random local names</div>
        <div>Protected output banner</div>
        <div>VM Protection</div>
        <div>Runtime integrity checks</div>
      </div></div>`;
  }

  res.send(`<!doctype html>
<html lang="en" data-theme="violet" data-appearance="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Karma Protection v6.2</title>
  <style>
    :root {
      --bg: #030303;
      --surface: rgba(15,15,16,0.85);
      --surface-2: rgba(25,25,28,0.7);
      --muted: #a1a1aa;
      --stroke: rgba(255,255,255,0.08);
      --stroke-hi: rgba(255,255,255,0.18);
      --text: #f8fafc;
      --text-2: #d4d4d8;
      --text-3: #a1a1aa;
      --accent: #d4af37;
      --gold: #d4af37;
      --gold2: #f1d592;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85)), 
                  radial-gradient(circle at 20% 30%, rgba(212,175,55,0.06), transparent 40%),
                  radial-gradient(circle at 80% 70%, rgba(212,175,55,0.04), transparent 35%),
                  #030303;
      color: var(--text);
      font-family: "SF Pro Display", "Aptos", "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif;
      letter-spacing: -0.01em;
    }
    a { color: inherit; text-decoration: none; }
    
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      border-bottom: 1px solid var(--stroke);
      background: rgba(3,3,3,0.92);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .topbar .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 780;
    }
    .topbar .brand img {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      border: 1px solid rgba(212,175,55,0.4);
    }
    .topbar .brand span { font-size: 18px; }
    .topbar .brand small { font-size: 12px; color: var(--muted); font-weight: 400; }
    
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(212,175,55,0.3);
      background: rgba(255,255,255,0.05);
      padding: 8px 16px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 13px;
      color: var(--text);
      cursor: pointer;
      transition: 0.2s;
    }
    .btn:hover { border-color: var(--gold); background: rgba(212,175,55,0.12); }
    .btn-accent { background: linear-gradient(180deg, var(--gold2), var(--gold)); color: #000; border-color: var(--gold); }
    .btn-accent:hover { transform: translateY(-1px); box-shadow: 0 8px 30px rgba(212,175,55,0.25); }
    .btn-dark { background: rgba(10,10,10,0.8); color: #fff; border-color: rgba(255,255,255,0.2); }
    
    .dashboard {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 0;
      min-height: calc(100vh - 68px);
    }
    .sidebar {
      background: rgba(8,8,8,0.95);
      border-right: 1px solid var(--stroke);
      padding: 20px 12px;
      overflow-y: auto;
      position: sticky;
      top: 68px;
      height: calc(100vh - 68px);
    }
    .sidebar .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 12px;
      color: var(--text-2);
      font-weight: 600;
      font-size: 14px;
      transition: 0.15s;
      margin-bottom: 2px;
    }
    .sidebar .nav-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
    .sidebar .nav-link.active { background: rgba(212,175,55,0.15); color: var(--gold); }
    .sidebar .nav-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-3);
      padding: 12px 14px 6px;
      font-weight: 700;
    }
    
    .main-content { padding: 24px 32px; overflow-y: auto; }
    
    .card {
      border: 1px solid var(--stroke);
      border-radius: 20px;
      background: var(--surface);
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
    }
    .card h2 { font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: -0.04em; margin: 4px 0 8px; }
    .card h3 { font-size: 16px; margin: 16px 0 8px; font-weight: 700; }
    .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-3); font-weight: 700; }
    .muted { color: var(--text-3); }
    .pad { padding: 8px 0; }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .stat {
      border: 1px solid var(--stroke);
      border-radius: 14px;
      background: var(--surface-2);
      padding: 16px;
    }
    .stat .num { font-size: 34px; font-weight: 850; letter-spacing: -0.04em; color: var(--gold); }
    .stat span { display: block; font-size: 13px; color: var(--text-3); margin-top: 4px; }
    
    .stat-card {
      border: 1px solid var(--stroke);
      border-radius: 16px;
      background: var(--surface-2);
      padding: 16px 20px;
    }
    .stat-card .kf-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
    .stat-card .text-accent { color: var(--gold); }
    .stat-card .text-txt { color: var(--text); }
    .stat-card .text-3xl { font-size: 30px; font-weight: 700; }
    .stat-card .tabular-nums { font-feature-settings: "tnum"; }
    
    .grid { display: grid; gap: 12px; }
    .grid-cols-2 { grid-template-columns: 1fr 1fr; }
    .gap-3 { gap: 12px; }
    @media (min-width: 1024px) { .lg\\:grid-cols-4 { grid-template-columns: repeat(4, 1fr); } }
    
    .filter-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .filter-bar a {
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--stroke);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-2);
      transition: 0.15s;
    }
    .filter-bar a:hover { border-color: var(--gold); color: var(--text); }
    
    input, textarea, select {
      width: 100%;
      background: rgba(8,8,9,0.9);
      color: #fff;
      border: 1px solid #343438;
      border-radius: 12px;
      padding: 10px 14px;
      margin: 6px 0 12px;
      font: inherit;
    }
    textarea { min-height: 120px; font-family: monospace; }
    .check { display: flex; gap: 10px; align-items: center; }
    .check input { width: auto; }
    .block {
      display: block;
      white-space: pre-wrap;
      word-break: break-all;
      padding: 12px;
      margin: 8px 0;
      background: rgba(8,8,9,0.9);
      border: 1px solid #343438;
      border-radius: 12px;
      font-family: monospace;
      font-size: 13px;
    }
    .row {
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 10px 14px;
      margin: 6px 0;
      background: rgba(11,11,12,0.6);
    }
    .buttonRow { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    
    .featureGrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .featureGrid div {
      border: 1px solid #27272a;
      border-radius: 14px;
      background: rgba(11,11,12,0.6);
      padding: 14px;
      text-align: center;
    }
    
    .anime {
      height: 140px;
      border-radius: 16px;
      border: 1px solid #27272a;
      margin-top: 16px;
      background: radial-gradient(circle at 30% 50%, rgba(212,175,55,0.12), transparent 18%),
                  radial-gradient(circle at 70% 50%, rgba(212,175,55,0.08), transparent 20%),
                  linear-gradient(120deg, #000, #111, #000);
      background-size: 160% 160%;
      animation: movebg 6s infinite alternate;
      position: relative;
      overflow: hidden;
    }
    .anime:after {
      content: '';
      position: absolute;
      inset: -40%;
      background: conic-gradient(from 0deg, transparent, rgba(212,175,55,0.08), transparent 35%);
      animation: spin 8s linear infinite;
    }
    @keyframes movebg { to { background-position: 100% 60%; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .scriptLink {
      display: block;
      border: 1px solid var(--stroke);
      background: rgba(14,14,14,0.8);
      border-radius: 14px;
      padding: 12px 14px;
      margin-bottom: 8px;
      transition: 0.15s;
    }
    .scriptLink:hover { border-color: var(--stroke-hi); }
    .scriptLink.active {
      border-color: var(--gold);
      background: linear-gradient(180deg, rgba(212,175,55,0.12), rgba(18,18,18,0.9));
    }
    .scriptLink b { display: block; font-size: 15px; }
    .scriptLink small { font-size: 12px; color: var(--text-3); }
    
    @media (max-width: 768px) {
      .dashboard { grid-template-columns: 1fr; }
      .sidebar { display: none; position: fixed; inset: 0; z-index: 100; height: 100vh; width: 280px; background: rgba(8,8,8,0.98); border-right: 1px solid var(--stroke); padding: 16px; }
      .sidebar.open { display: block; }
      .main-content { padding: 16px; }
      .grid-cols-2 { grid-template-columns: 1fr; }
      .stats { grid-template-columns: 1fr 1fr; }
      .featureGrid { grid-template-columns: 1fr; }
    }
    @media (max-width: 500px) { .stats { grid-template-columns: 1fr; } }
    
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #666; }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div>
        <span>⚡ Karma Protection v6.2</span>
        <small>secure & deliver</small>
      </div>
    </div>
    <div>
      <button class="btn btn-dark" onclick="document.getElementById('sidebar').classList.toggle('open')">☰ Menu</button>
    </div>
  </header>
  
  <div class="dashboard">
    <aside class="sidebar" id="sidebar">
      <div class="nav-label">Navigation</div>
      <a class="nav-link ${tab === 'overview' ? 'active' : ''}" href="/dashboard?tab=overview">📊 Overview</a>
      <a class="nav-link ${tab === 'scripts' ? 'active' : ''}" href="/dashboard?tab=scripts">📄 Scripts</a>
      <a class="nav-link ${tab === 'keys' ? 'active' : ''}" href="/dashboard?tab=keys">🔑 Keys</a>
      <div class="nav-label">Tools</div>
      <a class="nav-link ${tab === 'obfuscate' ? 'active' : ''}" href="/dashboard?tab=obfuscate">⚙️ Obfuscator</a>
    </aside>
    
    <main class="main-content">
      ${content}
    </main>
  </div>
  
  <script>
    document.getElementById('fileInput')?.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const nameInput = document.querySelector('input[name="name"]');
      if (nameInput && !nameInput.value) {
        nameInput.value = f.name.replace(/\\.(lua|txt)$/i, '');
      }
      const codeBox = document.getElementById('codeBox');
      if (codeBox) codeBox.value = await f.text();
    });
    
    document.addEventListener('click', function(e) {
      const sidebar = document.getElementById('sidebar');
      if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('open')) {
        if (!sidebar.contains(e.target) && !e.target.closest('.topbar')) {
          sidebar.classList.remove('open');
        }
      }
    });
  </script>
</body>
</html>`);
});

// ---------------- API Routes ----------------
app.post('/dashboard/scripts', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const code = String(req.body.code || '').slice(0, 4000);
  const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
  const level = String(req.body.level || 'standard');
  if (!name || !code) return res.status(400).send('<h1>Missing name or code</h1><a href="/dashboard?tab=scripts">Back</a>');

  let finalCode = code;
  if (shouldObfuscate) {
    try {
      finalCode = await callObfuscator(code, level);
    } catch (error) {
      return res.status(500).send(`<h1>Obfuscation failed</h1><p>${escapeHtml(error.message)}</p><a href="/dashboard?tab=scripts">Back</a>`);
    }
  }

  const id = makeId('host');
  db.prepare(`
    INSERT INTO hosted_scripts (id, name, code, source_code, obfuscated, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, finalCode, code, shouldObfuscate ? 1 : 0, 'web');

  res.redirect('/dashboard?tab=scripts');
});

app.post('/dashboard/scripts/:id/update', async (req, res) => {
  const current = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).send('<h1>Script not found</h1><a href="/dashboard?tab=scripts">Back</a>');

  const name = String(req.body.name || current.name).trim().slice(0, 80);
  const source = String(req.body.code || '').slice(0, 4000);
  const level = String(req.body.level || 'standard');
  const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
  if (!name || !source) return res.status(400).send('<h1>Missing name or code</h1><a href="/dashboard?tab=scripts">Back</a>');

  let finalCode = source;
  if (shouldObfuscate) {
    try {
      finalCode = await callObfuscator(source, level);
    } catch (error) {
      return res.status(500).send(`<h1>Obfuscation failed</h1><p>${escapeHtml(error.message)}</p><a href="/dashboard?tab=scripts">Back</a>`);
    }
  }

  db.prepare('UPDATE hosted_scripts SET name = ?, code = ?, source_code = ?, obfuscated = ? WHERE id = ?')
    .run(name, finalCode, source, shouldObfuscate ? 1 : 0, req.params.id);
  res.redirect(`/dashboard?tab=scripts&script=${encodeURIComponent(req.params.id)}`);
});

app.post('/dashboard/keys', (req, res) => {
  const scriptId = String(req.body.script_id || '').trim();
  const days = Math.max(0, Math.min(3650, Number(req.body.days || 0)));
  const quantity = Math.max(1, Math.min(20, Number(req.body.quantity || 1)));
  
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId);
  if (!script) {
    // Create script if it doesn't exist
    const newScript = { id: scriptId, name: 'Project', apiSecret: 'manual' };
    db.prepare('INSERT OR IGNORE INTO scripts (id, name, api_secret_hash, api_secret_preview, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(scriptId, 'Project', hashSecret('manual'), 'manual...', 'web');
  }

  const expiresAt = addDays(days);
  const insert = db.prepare('INSERT INTO licenses (license_key, script_id, expires_at, created_by) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < quantity; i++) {
    const key = makeKey('KS');
    insert.run(key, scriptId, expiresAt, 'web');
  }
  res.redirect('/dashboard?tab=keys');
});

app.post('/dashboard/obfuscate', async (req, res) => {
  const code = String(req.body.code || '').slice(0, 4000);
  const filename = String(req.body.filename || req.body.name || 'obfuscated.lua').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const level = String(req.body.level || 'standard');
  
  if (!code) return res.status(400).send('<h1>Missing code</h1><a href="/dashboard?tab=obfuscate">Back</a>');
  
  try {
    const obfuscated = await callObfuscator(code, level);
    return res.send(`<!doctype html>
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Obfuscated - Karma Protection</title>
    <style>
      body{margin:0;background:#000;color:#fff;font-family:system-ui}
      .wrap{width:min(1100px,94%);margin:32px auto}
      .card{border:1px solid #2a2a2d;border-radius:28px;background:linear-gradient(180deg,#181818,#080808);padding:24px}
      textarea{width:100%;min-height:62vh;background:#050505;color:#fff;border:1px solid #333;border-radius:16px;padding:14px;font:12px monospace}
      button,a{display:inline-flex;margin:10px 8px 18px 0;padding:12px 16px;border-radius:999px;border:1px solid #d4af37;background:transparent;color:#d4af37;text-decoration:none;font-weight:900;cursor:pointer}
      button:hover,a:hover{background:#d4af37;color:#000}
      .accent{background:#d4af37;color:#000}
      .accent:hover{background:#e3c94a}
    </style>
    </head><body>
    <div class="wrap">
      <div class="card">
        <h1>✨ Obfuscated Successfully</h1>
        <p>Level: <b>${escapeHtml(level)}</b>. Copy it below — no download needed.</p>
        <button class="accent" onclick="navigator.clipboard.writeText(document.getElementById('out').value)">📋 Copy Obfuscated Code</button>
        <a href="/dashboard?tab=obfuscate">← Back to Obfuscator</a>
        <a href="/dashboard?tab=scripts">📄 Scripts</a>
        <textarea id="out" spellcheck="false">${escapeHtml(obfuscated)}</textarea>
      </div>
    </div>
    </body></html>`);
  } catch (error) {
    return res.status(500).send(`<h1>Obfuscation failed</h1><p>${escapeHtml(error.message)}</p><a href="/dashboard?tab=obfuscate">Back</a>`);
  }
});

app.get('/script/:id.lua', (req, res) => {
  const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
  if (!script) return res.status(404).type('text/plain').send('-- Karma Protection: script not found');
  res.setHeader('Cache-Control', 'no-store');
  return res.type('text/plain').send(script.code);
});

app.get('/loadstring/:id', (req, res) => {
  const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
  if (!script) return res.status(404).type('text/plain').send('-- Karma Protection: script not found');
  const rawUrl = `${publicBaseUrl()}/script/${script.id}.lua`;
  res.setHeader('Cache-Control', 'no-store');
  return res.type('text/plain').send(makeProtectedLoader(rawUrl, script.id));
});

app.get('/api/stats', (req, res) => {
  const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
  const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
  res.json({ scripts: scriptCount, keys: keyCount });
});

app.post('/api/log-execution', (req, res) => {
  const { script_id, key, hwid, executor } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  if (script_id) {
    db.prepare('INSERT INTO execution_logs (script_id, license_key, hwid, ip, executor) VALUES (?, ?, ?, ?, ?)')
      .run(script_id, key || null, hwid || null, ip || null, executor || null);
  }
  return res.json({ ok: true });
});

app.post('/api/verify', (req, res) => {
  const { script_id, key, hwid } = req.body || {};
  const apiSecret = req.header('X-API-Secret');

  if (!script_id || !key || !hwid || !apiSecret) {
    return res.status(400).json({ ok: false, message: 'Missing required fields' });
  }

  const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(String(hwid));
  if (banned) {
    return res.status(403).json({ ok: false, message: 'HWID banned', reason: banned.reason || 'No reason provided' });
  }

  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(script_id);
  if (!script || script.api_secret_hash !== hashSecret(apiSecret)) {
    return res.status(401).json({ ok: false, message: 'Invalid script or API secret' });
  }

  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND script_id = ?').get(key, script_id);
  if (!license) return res.status(404).json({ ok: false, message: 'Invalid key' });
  if (license.revoked) return res.status(403).json({ ok: false, message: 'Key revoked' });
  if (isExpired(license.expires_at)) return res.status(403).json({ ok: false, message: 'Key expired' });
  if (!license.discord_user_id) return res.status(403).json({ ok: false, message: 'Key not redeemed' });
  if (license.hwid && license.hwid !== hwid) return res.status(403).json({ ok: false, message: 'HWID mismatch' });

  if (!license.hwid) db.prepare('UPDATE licenses SET hwid = ? WHERE license_key = ?').run(hwid, key);

  return res.json({
    ok: true,
    message: 'License verified',
    discord_user_id: license.discord_user_id,
    expires_at: license.expires_at,
    script_id
  });
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---------------- Start Server ----------------
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`Karma Protection v6.2 running on port ${port}`);
  console.log(`Dashboard: http://localhost:${port}/dashboard`);
});
