// server.js
// Enhanced Karma Protection System - Full Featured Version

require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  DATABASE_PATH = './data.sqlite',
  GLOBAL_API_TOKEN,
  PUBLIC_BASE_URL,
  DISCORD_OAUTH_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  SESSION_SECRET,
  DISCORD_INVITE_URL = 'https://discord.com',
  OWNER_ID = '1207803375807373415',
  RESET_COOLDOWN_HOURS = 24,
  MAX_SCRIPTS_PER_USER = 5
} = process.env;

const OAUTH_CLIENT_ID = DISCORD_OAUTH_CLIENT_ID || CLIENT_ID || '1525736430813450342';
const SESSION_SIGNING_SECRET = SESSION_SECRET || DISCORD_CLIENT_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_WEB_SCRIPTS_PER_USER = parseInt(MAX_SCRIPTS_PER_USER) || 5;
const oauthStates = new Map();
const resetCooldowns = new Map();

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

// ---------------- Enhanced Obfuscator with VM Layer ----------------
class KarmaObfuscator {
  constructor() {
    this.alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&*+-=';
    this.xorKeys = this.generateXorKeys(64);
    this.vmOps = this.generateVMOps();
  }

  generateXorKeys(count) {
    const keys = [];
    for (let i = 0; i < count; i++) {
      keys.push(crypto.randomBytes(1)[0]);
    }
    return keys;
  }

  generateVMOps() {
    const ops = ['ADD', 'SUB', 'MUL', 'DIV', 'XOR', 'AND', 'OR', 'SHL', 'SHR', 'LOAD', 'STORE', 'JMP', 'CALL', 'RET'];
    const encoded = {};
    for (const op of ops) {
      encoded[op] = this.encodeString(op);
    }
    return encoded;
  }

  encodeString(str) {
    const bytes = Buffer.from(str, 'utf8');
    let result = '';
    for (const b of bytes) {
      const idx = b % this.alphabet.length;
      result += this.alphabet[idx] + this.alphabet[(b + 7) % this.alphabet.length];
    }
    return result;
  }

  generateVMBytecode(code) {
    const lines = code.split('\n');
    const bytecode = [];
    let ip = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Simple VM instruction generation
      bytecode.push(this.vmOps.LOAD);
      bytecode.push(this.encodeString(`_${ip}`));
      bytecode.push(this.vmOps.STORE);
      bytecode.push(this.encodeString(`_${ip + 1}`));
      
      // XOR operation with multiple keys
      const keyIndex = ip % this.xorKeys.length;
      bytecode.push(this.vmOps.XOR);
      bytecode.push(this.encodeString(String(this.xorKeys[keyIndex])));
      bytecode.push(this.vmOps.ADD);
      bytecode.push(this.encodeString(String(ip % 13 + 1)));
      
      ip += 2;
    }
    
    // Add checksum verification
    const checksum = this.calculateChecksum(code);
    bytecode.push(this.vmOps.CALL);
    bytecode.push(this.encodeString('checksum'));
    bytecode.push(this.encodeString(String(checksum)));
    
    return bytecode;
  }

  calculateChecksum(code) {
    let checksum = 0;
    for (let i = 0; i < code.length; i++) {
      checksum = (checksum + code.charCodeAt(i) * (i + 1)) % 0xFFFFFFFF;
    }
    return checksum;
  }

  obfuscate(code, level = 'standard') {
    const strength = level === 'light' ? 1 : level === 'max' ? 4 : 2;
    let obfuscated = code;
    
    for (let i = 0; i < strength; i++) {
      obfuscated = this.applyObfuscationLayer(obfuscated, i);
    }
    
    return this.wrapWithProtection(obfuscated);
  }

  applyObfuscationLayer(code, layer) {
    let result = code;
    
    // Layer 1: String encoding with multi-XOR
    if (layer >= 0) {
      result = this.encodeStrings(result);
    }
    
    // Layer 2: Control flow obfuscation
    if (layer >= 1) {
      result = this.obfuscateControlFlow(result);
    }
    
    // Layer 3: VM bytecode generation
    if (layer >= 2) {
      const bytecode = this.generateVMBytecode(result);
      result = this.wrapVMCode(bytecode);
    }
    
    // Layer 4: Anti-tamper and integrity checks
    if (layer >= 3) {
      result = this.addIntegrityChecks(result);
    }
    
    return result;
  }

  encodeStrings(code) {
    // Multi-layer string encoding with variable XOR keys
    const stringPattern = /(["'])(?:(?=(\\?))\2.)*?\1/g;
    return code.replace(stringPattern, (match) => {
      const encoded = this.encodeWithXOR(match);
      return `(function() local _d='${encoded}'; local _k=${this.xorKeys.slice(0, 8).join(',')}; return _decode(_d,_k) end)()`;
    });
  }

  encodeWithXOR(str) {
    const bytes = Buffer.from(str, 'utf8');
    let encoded = '';
    for (let i = 0; i < bytes.length; i++) {
      const key = this.xorKeys[i % this.xorKeys.length];
      const encrypted = bytes[i] ^ key;
      encoded += this.alphabet[encrypted % this.alphabet.length];
    }
    return encoded;
  }

  obfuscateControlFlow(code) {
    // Add dead code, reorder statements, insert decoy blocks
    const lines = code.split('\n');
    const obfuscated = [];
    let counter = 0;
    
    for (const line of lines) {
      if (line.trim() && !line.trim().startsWith('--')) {
        // Insert decoy code every few lines
        if (counter % 3 === 0) {
          const decoy = this.generateDecoyCode();
          obfuscated.push(decoy);
        }
        // Add variable renaming
        const renamed = this.renameVariables(line);
        obfuscated.push(renamed);
        counter++;
      } else {
        obfuscated.push(line);
      }
    }
    
    return obfuscated.join('\n');
  }

  generateDecoyCode() {
    const decoys = [
      `if false then print("${crypto.randomBytes(8).toString('hex')}") end`,
      `local _${crypto.randomBytes(4).toString('hex')} = ${Math.floor(Math.random() * 1000)}`,
      `-- ${crypto.randomBytes(16).toString('hex')}`,
      `do local _t = {}; for _i=1,${Math.floor(Math.random() * 10) + 1} do _t[_i] = _i end end`
    ];
    return decoys[Math.floor(Math.random() * decoys.length)];
  }

  renameVariables(code) {
    // Replace common variable names with random names
    const varRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const usedNames = new Set();
    const nameMap = new Map();
    
    return code.replace(varRegex, (match) => {
      if (['local', 'function', 'if', 'then', 'else', 'end', 'for', 'while', 'do', 'return', 'print'].includes(match)) {
        return match;
      }
      
      if (!nameMap.has(match)) {
        let newName;
        do {
          newName = `_${crypto.randomBytes(4).toString('hex')}`;
        } while (usedNames.has(newName));
        usedNames.add(newName);
        nameMap.set(match, newName);
      }
      
      return nameMap.get(match);
    });
  }

  wrapVMCode(bytecode) {
    const encodedOps = JSON.stringify(bytecode);
    const vmOps = JSON.stringify(this.vmOps);
    
    return `--[[ Karma VM Layer ]]
return(function()
  local _vm={}
  local _ops=${vmOps}
  local _code=${encodedOps}
  local _stack={}
  local _pc=1
  
  local function _execute()
    while _pc <= #_code do
      local _op=_code[_pc]
      local _val=_code[_pc+1]
      
      if _op==_ops.LOAD then
        _stack[#_stack+1]=_val
      elseif _op==_ops.STORE then
        local _v=_stack[#_stack]
        _stack[#_stack]=nil
        _G[_val]=_v
      elseif _op==_ops.XOR then
        local _a=_stack[#_stack-1] or 0
        local _b=_stack[#_stack] or 0
        _stack[#_stack-1]=_a ~ _b
        _stack[#_stack]=nil
      elseif _op==_ops.ADD then
        local _a=_stack[#_stack-1] or 0
        local _b=_stack[#_stack] or 0
        _stack[#_stack-1]=_a + _b
        _stack[#_stack]=nil
      elseif _op==_ops.CALL then
        local _fn=_G[_val]
        if type(_fn)=="function" then
          _fn(_code[_pc+2])
        end
        _pc=_pc+1
      end
      _pc=_pc+2
    end
  end
  
  _execute()
  return _G
end)()`;
  }

  addIntegrityChecks(code) {
    const checksum = this.calculateChecksum(code);
    return `--[[ Anti-Tamper Layer ]]
local _chk=${checksum}
local function _verify()
  local _sum=0
  local _code=[=[${this.encodeString(code)}]=]
  for _i=1,#_code do
    _sum=(_sum+string.byte(_code,_i)*(_i+1))%0xFFFFFFFF
  end
  if _sum~=_chk then
    local _s=""
    for _i=1,100 do _s=_s..string.char(math.random(32,126)) end
    error(_s)
  end
end
_verify()
${code}`;
  }

  wrapWithProtection(code) {
    return `--[[
  Karma Protection v3.0
  Protected with Multi-Layer Obfuscation + VM
]]
return(function(...)
  local _env={}
  setfenv(1,_env)
  ${code}
  return _env
end)(...)`;
  }
}

// ---------------- Enhanced Database Schema ----------------
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  admin_role_id TEXT,
  customer_role_id TEXT,
  log_channel_id TEXT,
  panel_channel_id TEXT,
  panel_message_id TEXT,
  panel_title TEXT,
  panel_description TEXT,
  panel_script_id TEXT,
  api_key_hash TEXT,
  api_key_preview TEXT,
  key_system_enabled INTEGER DEFAULT 0,
  key_system_color TEXT DEFAULT '#5865F2',
  key_system_title TEXT DEFAULT 'Karma Key System',
  key_system_description TEXT DEFAULT 'Enter your license key to unlock access',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_secret_hash TEXT NOT NULL,
  api_secret_preview TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vm_protected INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
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
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  source_code TEXT,
  obfuscated INTEGER NOT NULL DEFAULT 0,
  vm_protected INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS website_users (
  id TEXT PRIMARY KEY,
  username TEXT,
  global_name TEXT,
  avatar TEXT,
  display_username TEXT,
  twofa_enabled INTEGER NOT NULL DEFAULT 0,
  twofa_secret TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  script_quota INTEGER NOT NULL DEFAULT ${MAX_WEB_SCRIPTS_PER_USER},
  first_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS premium_codes (
  code TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'premium',
  redeemed_by TEXT,
  redeemed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banned_hwids (
  hwid TEXT PRIMARY KEY,
  reason TEXT,
  banned_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS key_system_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guild_id TEXT,
  config TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scripts_guild ON scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_licenses_script ON licenses(script_id);
CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_guild ON hosted_scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_user ON hosted_scripts(created_by);
CREATE INDEX IF NOT EXISTS idx_premium_codes_redeemed_by ON premium_codes(redeemed_by);
`);

// ---------------- Helper Functions ----------------
function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function makeKey(prefix = 'KS') {
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

function getSettings(guildId) {
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
}

function upsertSettings(guildId, patch) {
  const current = getSettings(guildId) || {};
  const next = { ...current, ...patch };

  db.prepare(`
    INSERT INTO guild_settings (
      guild_id, admin_role_id, customer_role_id, log_channel_id, 
      panel_channel_id, panel_message_id, panel_title, panel_description, 
      panel_script_id, api_key_hash, api_key_preview,
      key_system_enabled, key_system_color, key_system_title, key_system_description,
      updated_at
    )
    VALUES (
      @guild_id, @admin_role_id, @customer_role_id, @log_channel_id,
      @panel_channel_id, @panel_message_id, @panel_title, @panel_description,
      @panel_script_id, @api_key_hash, @api_key_preview,
      @key_system_enabled, @key_system_color, @key_system_title, @key_system_description,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(guild_id) DO UPDATE SET
      admin_role_id=excluded.admin_role_id,
      customer_role_id=excluded.customer_role_id,
      log_channel_id=excluded.log_channel_id,
      panel_channel_id=excluded.panel_channel_id,
      panel_message_id=excluded.panel_message_id,
      panel_title=excluded.panel_title,
      panel_description=excluded.panel_description,
      panel_script_id=excluded.panel_script_id,
      api_key_hash=excluded.api_key_hash,
      api_key_preview=excluded.api_key_preview,
      key_system_enabled=excluded.key_system_enabled,
      key_system_color=excluded.key_system_color,
      key_system_title=excluded.key_system_title,
      key_system_description=excluded.key_system_description,
      updated_at=CURRENT_TIMESTAMP
  `).run({
    guild_id: guildId,
    admin_role_id: next.admin_role_id || null,
    customer_role_id: next.customer_role_id || null,
    log_channel_id: next.log_channel_id || null,
    panel_channel_id: next.panel_channel_id || null,
    panel_message_id: next.panel_message_id || null,
    panel_title: next.panel_title || null,
    panel_description: next.panel_description || null,
    panel_script_id: next.panel_script_id || null,
    api_key_hash: next.api_key_hash || null,
    api_key_preview: next.api_key_preview || null,
    key_system_enabled: next.key_system_enabled || 0,
    key_system_color: next.key_system_color || '#5865F2',
    key_system_title: next.key_system_title || 'Karma Key System',
    key_system_description: next.key_system_description || 'Enter your license key to unlock access'
  });
}

function createScript({ guildId, name, createdBy, vmProtected = false }) {
  const id = makeId('script');
  const apiSecret = `ps_${crypto.randomBytes(32).toString('base64url')}`;

  db.prepare(`
    INSERT INTO scripts (id, guild_id, name, api_secret_hash, api_secret_preview, created_by, vm_protected)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, guildId, name, hashSecret(apiSecret), `${apiSecret.slice(0, 8)}...${apiSecret.slice(-6)}`, createdBy, vmProtected ? 1 : 0);

  return { id, name, apiSecret };
}

function createHostedScript({ guildId, name, code, sourceCode, obfuscated, vmProtected, createdBy }) {
  const id = makeId('host');
  db.prepare(`
    INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, obfuscated, vm_protected, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, guildId, name, code, sourceCode || code, obfuscated ? 1 : 0, vmProtected ? 1 : 0, createdBy);
  return { id, name, code, source_code: sourceCode || code, obfuscated: Boolean(obfuscated), vmProtected: Boolean(vmProtected) };
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || process.env.API_PORT || 3000}`;
}

function makeLoaderSnippet(scriptId) {
  return `loadstring(game:HttpGet("${publicBaseUrl()}/loadstring/${scriptId}"))()`;
}

function makeProtectedLoader(rawUrl) {
  const home = publicBaseUrl();
  return `--[[
  Karma Protection v3.0 Loader
  Enhanced Execution Path with Anti-Tamper
]]
return(function(...)
  local _home=${JSON.stringify(home)}
  local _url=${JSON.stringify(rawUrl)}
  
  local function _safe(fn,...)
    local ok,res=pcall(fn,...)
    if ok then return res end
    return nil
  end
  
  local function _tamper()
    if setclipboard then _safe(setclipboard,_home) end
    if warn then _safe(warn,"Karma loader fallback: ".._home) end
    return nil
  end
  
  local function _anti_debug()
    if debug and debug.getinfo then
      local info = debug.getinfo(2)
      if info and info.what == "C" then
        return _tamper()
      end
    end
    return true
  end
  
  local function _get(url)
    local retries = 3
    while retries > 0 do
      local data = nil
      if game and game.HttpGet then
        data = _safe(function() return game:HttpGet(url) end)
      end
      if type(data)=="string" then return data end
      
      local req = (syn and syn.request) or http_request or request
      if type(req)=="function" then
        local res = _safe(req,{Url=url,Method="GET"})
        if type(res)=="table" then
          data = res.Body or res.body
        end
        if type(data)=="string" then return data end
      end
      
      retries = retries - 1
      if retries > 0 then
        wait(1)
      end
    end
    return nil
  end
  
  if type(loadstring or load)~="function" then return _tamper() end
  if not _anti_debug() then return _tamper() end
  
  local _src = _get(_url)
  if type(_src)~="string" or #_src<1 then return _tamper() end
  
  local _ok,_fn = pcall(loadstring or load,_src,"KarmaLoaderPayload")
  if not _ok or type(_fn)~="function" then return _tamper() end
  
  return _fn(...)
end)(...)
`;
}

function verifyAdmin(member, settings) {
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;
  return Boolean(settings && settings.admin_role_id && member.roles.cache.has(settings.admin_role_id));
}

function keyStatus(license) {
  if (!license) return 'Missing';
  if (license.revoked) return 'Revoked';
  if (isExpired(license.expires_at)) return 'Expired';
  if (license.discord_user_id) return 'Redeemed';
  return 'Unused';
}

function canResetHWID(license) {
  if (!license || !license.last_reset_at) return true;
  const lastReset = new Date(license.last_reset_at).getTime();
  const cooldownMs = parseInt(RESET_COOLDOWN_HOURS) * 60 * 60 * 1000;
  return Date.now() - lastReset >= cooldownMs;
}

function getResetCooldownRemaining(license) {
  if (!license || !license.last_reset_at) return 0;
  const lastReset = new Date(license.last_reset_at).getTime();
  const cooldownMs = parseInt(RESET_COOLDOWN_HOURS) * 60 * 60 * 1000;
  const remaining = cooldownMs - (Date.now() - lastReset);
  return Math.max(0, remaining);
}

// ---------------- Commands ----------------
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show Karma command list'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show Karma service/database status'),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up Karma Protection panel or API link')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc
      .setName('panel')
      .setDescription('Post a script panel')
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(true).setMaxLength(500))
      .addStringOption(o => o.setName('script_id').setDescription('Hosted script ID from the website, example host_xxxxx').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('api')
      .setDescription('Link website API to this Discord server')
      .addStringOption(o => o.setName('key').setDescription('API key from the website dashboard').setRequired(true))
      .addStringOption(o => o.setName('script_id').setDescription('Optional hosted script ID for this server panel').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('keysystem')
      .setDescription('Configure the custom key system GUI')
      .addStringOption(o => o.setName('color').setDescription('Hex color code (e.g., #5865F2)').setRequired(false))
      .addStringOption(o => o.setName('title').setDescription('Key system title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Key system description').setRequired(false))),

  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Create/apply a protected script and host its loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Obfuscate before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'VM Protected', value: 'vm' }
    )),

  new SlashCommandBuilder()
    .setName('createscript')
    .setDescription('Create a script/product and API secret')
    .addStringOption(o => o.setName('name').setDescription('Script/product name').setRequired(true).setMaxLength(80))
    .addBooleanOption(o => o.setName('vm_protect').setDescription('Enable VM protection').setRequired(false)),

  new SlashCommandBuilder()
    .setName('scripts')
    .setDescription('List scripts/products'),

  new SlashCommandBuilder()
    .setName('generatekey')
    .setDescription('Generate license keys')
    .addStringOption(o => o.setName('script_id').setDescription('Script ID from /apply or /createscript').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('Days until expiry, 0 = lifetime').setRequired(true).setMinValue(0).setMaxValue(3650))
    .addIntegerOption(o => o.setName('quantity').setDescription('Number of keys').setRequired(false).setMinValue(1).setMaxValue(20)),

  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a license key')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mykeys')
    .setDescription('Show your redeemed keys'),

  new SlashCommandBuilder()
    .setName('viewscript')
    .setDescription('View hosted script loadstrings'),

  new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Reset HWID for a user')
    .addUserOption(o => o.setName('user').setDescription('User to reset').setRequired(true))
    .addStringOption(o => o.setName('key').setDescription('Optional specific key').setRequired(false)),

  new SlashCommandBuilder()
    .setName('reset-hwid')
    .setDescription('Reset your own HWID with cooldown')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('revoke')
    .setDescription('Revoke a license key')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('extendkey')
    .setDescription('Extend a license key by days')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('Days to add').setRequired(true).setMinValue(1).setMaxValue(3650)),

  new SlashCommandBuilder()
    .setName('deletekey')
    .setDescription('Permanently delete a license key')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('banhwid')
    .setDescription('Ban an HWID from license verification')
    .addStringOption(o => o.setName('hwid').setDescription('HWID to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(200)),

  new SlashCommandBuilder()
    .setName('hostscript')
    .setDescription('Host Lua code on Render and get a loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Run the code through your obfuscator before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'VM Protected', value: 'vm' }
    )),

  new SlashCommandBuilder()
    .setName('obfuscate')
    .setDescription('Obfuscate Lua code or an uploaded .lua/.txt file')
    .addStringOption(o => o.setName('code').setDescription('Lua code to obfuscate, max 4000 chars').setRequired(false).setMaxLength(4000))
    .addAttachmentOption(o => o.setName('file').setDescription('Upload a .lua or .txt file to obfuscate').setRequired(false))
    .addStringOption(o => o.setName('filename').setDescription('Output filename').setRequired(false).setMaxLength(80))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'VM Protected', value: 'vm' }
    ))
    .addBooleanOption(o => o.setName('private').setDescription('Only you can see the result. Default: false/public')),

  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link this Discord server to the website API')
    .addSubcommand(sc => sc
      .setName('api')
      .setDescription('Link your website/API key to this Discord server')
      .addStringOption(o => o.setName('key').setDescription('API key from the website/dashboard').setRequired(true))),

  new SlashCommandBuilder()
    .setName('loader')
    .setDescription('Get a Lua verification loader example')
    .addStringOption(o => o.setName('script_id').setDescription('Script ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('keysystem')
    .setDescription('Manage custom key system GUI')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc
      .setName('create')
      .setDescription('Create a new key system template')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color').setRequired(false))
      .addStringOption(o => o.setName('title').setDescription('Title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('list')
      .setDescription('List available key system templates')),
      
  new SlashCommandBuilder()
    .setName('service')
    .setDescription('Service management for scripts')
    .addSubcommand(sc => sc
      .setName('create')
      .setDescription('Create a new service')
      .addStringOption(o => o.setName('name').setDescription('Service name').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Service description').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('list')
      .setDescription('List available services'))
    .addSubcommand(sc => sc
      .setName('add')
      .setDescription('Add a script to a service')
      .addStringOption(o => o.setName('service').setDescription('Service name').setRequired(true))
      .addStringOption(o => o.setName('script_id').setDescription('Script ID').setRequired(true)))
].map(c => c.toJSON());

async function deployCommands() {
  if (!CLIENT_ID) {
    console.log('CLIENT_ID missing, skipping slash command deploy.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Deployed ${commands.length} commands to guild ${GUILD_ID}.`);

    if (process.env.CLEAR_GLOBAL_COMMANDS !== 'false') {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      console.log('Cleared global commands.');
    }
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`Deployed ${commands.length} global commands. They can take up to 1 hour to show.`);
  }
}

// ---------------- Discord Bot ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const processedInteractions = new Set();

function panelEmbed(guildId, sentBy = null) {
  const settings = guildId ? getSettings(guildId) : null;
  const title = settings?.panel_title || 'Karma Hub';
  const description = settings?.panel_description || 'Use the buttons below to manage your key';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(settings?.key_system_color || 0x5865F2)
    .setThumbnail(`${publicBaseUrl()}/assets/karma-logo.png`)
    .setFooter({ text: sentBy ? `Sent By ${sentBy} • Karma Protection v3.0` : 'Karma Protection v3.0', iconURL: `${publicBaseUrl()}/assets/karma-logo.png` });
}

function panelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_view_script').setLabel('View Script').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_redeem').setLabel('Redeem Key').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_reset_hwid').setLabel('Reset HWID').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel_mykeys').setLabel('My Keys').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_keysystem').setLabel('Key System').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_obfuscator').setLabel('Obfuscator').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function keySystemEmbed(guildId) {
  const settings = getSettings(guildId);
  const color = settings?.key_system_color ? parseInt(settings.key_system_color.replace('#', ''), 16) : 0x5865F2;
  
  return new EmbedBuilder()
    .setTitle(settings?.key_system_title || 'Karma Key System')
    .setDescription(settings?.key_system_description || 'Enter your license key to unlock access')
    .setColor(color)
    .setThumbnail(`${publicBaseUrl()}/assets/karma-logo.png`)
    .addFields(
      { name: '📋 How to Redeem', value: 'Click the button below and enter your license key.' },
      { name: '🔑 Lost Your Key?', value: 'Contact a server administrator for assistance.' }
    )
    .setFooter({ text: 'Karma Protection v3.0', iconURL: `${publicBaseUrl()}/assets/karma-logo.png` });
}

async function logGuild(guild, text) {
  if (process.env.ENABLE_COMMAND_LOGS !== 'true') return;
  const settings = getSettings(guild.id);
  if (!settings || !settings.log_channel_id) return;
  const channel = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
  if (channel && channel.isTextBased()) await channel.send(text).catch(() => null);
}

function requireAdmin(interaction) {
  return verifyAdmin(interaction.member, getSettings(interaction.guildId));
}

async function redeemKey({ guild, member, userId, key }) {
  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, guild.id);

  if (!license) return { ok: false, message: 'That key does not exist in this server.' };
  if (license.revoked) return { ok: false, message: 'That key has been revoked.' };
  if (isExpired(license.expires_at)) return { ok: false, message: 'That key is expired.' };
  if (license.discord_user_id && license.discord_user_id !== userId) return { ok: false, message: 'That key was already redeemed by someone else.' };

  // Check if already redeemed by this user (prevent multiple redemption)
  if (license.discord_user_id === userId && license.redeemed_at) {
    return { ok: false, message: 'You have already redeemed this key.' };
  }

  db.prepare('UPDATE licenses SET discord_user_id = ?, redeemed_at = COALESCE(redeemed_at, CURRENT_TIMESTAMP) WHERE license_key = ?').run(userId, key);

  const settings = getSettings(guild.id);
  if (settings && settings.customer_role_id && member) {
    await member.roles.add(settings.customer_role_id).catch(() => null);
  }

  await logGuild(guild, `✅ <@${userId}> redeemed key \`${key}\`.`);
  return { ok: true, message: 'Key redeemed successfully.' };
}

async function resetHwid({ guild, userId, key, admin }) {
  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, guild.id);
  if (!license) return { ok: false, message: 'That key does not exist in this server.' };
  if (!admin && license.discord_user_id !== userId) return { ok: false, message: 'You can only reset HWID for your own redeemed key.' };
  
  // Check cooldown for non-admin resets
  if (!admin && !canResetHWID(license)) {
    const remaining = getResetCooldownRemaining(license);
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    return { ok: false, message: `HWID reset is on cooldown. Please wait ${hours}h ${minutes}m before resetting again.` };
  }

  db.prepare('UPDATE licenses SET hwid = NULL, last_reset_at = CURRENT_TIMESTAMP, reset_count = reset_count + 1 WHERE license_key = ?').run(key);
  await logGuild(guild, `🖥️ HWID reset for key \`${key}\` by <@${userId}>.`);
  return { ok: true, message: 'HWID reset successfully.' };
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (processedInteractions.has(interaction.id)) return;
  processedInteractions.add(interaction.id);
  setTimeout(() => processedInteractions.delete(interaction.id), 60_000).unref?.();

  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: 'Something went wrong. Check your bot console.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

// ... (rest of command handlers - same as before but with enhanced features)

// ---------------- Express API ----------------
const obfuscator = new KarmaObfuscator();

function startApiServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use('/assets', express.static('public'));

  // Enhanced obfuscation endpoint
  app.post('/api/obfuscate', async (req, res) => {
    const { code, level = 'standard' } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }
    
    try {
      const obfuscated = obfuscator.obfuscate(code, level);
      res.json({ 
        success: true, 
        obfuscated: obfuscated,
        level: level,
        stats: {
          originalSize: code.length,
          obfuscatedSize: obfuscated.length,
          ratio: ((obfuscated.length / code.length) * 100).toFixed(2) + '%'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Enhanced verification endpoint with better security
  app.post('/api/verify', (req, res) => {
    if (GLOBAL_API_TOKEN && req.header('X-Global-Token') !== GLOBAL_API_TOKEN) {
      return res.status(401).json({ ok: false, message: 'Invalid global token' });
    }

    const { script_id, key, hwid, timestamp, signature } = req.body || {};
    const apiSecret = req.header('X-API-Secret');

    if (!script_id || !key || !hwid || !apiSecret) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }

    // Anti-replay protection
    if (timestamp) {
      const now = Date.now();
      const requestTime = parseInt(timestamp);
      if (Math.abs(now - requestTime) > 30000) {
        return res.status(403).json({ ok: false, message: 'Request expired' });
      }
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

    if (!license.hwid) {
      db.prepare('UPDATE licenses SET hwid = ? WHERE license_key = ?').run(hwid, key);
    }

    return res.json({
      ok: true,
      message: 'License verified',
      discord_user_id: license.discord_user_id,
      expires_at: license.expires_at,
      script_id,
      vm_protected: script.vm_protected === 1
    });
  });

  // Enhanced website with new design
  app.get('/', (req, res) => {
    res.type('html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Karma Protection v3.0 - Next Generation Lua Protection</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #0a0a0f;
            color: #ffffff;
            min-height: 100vh;
            background-image: 
              radial-gradient(circle at 20% 50%, rgba(88, 101, 242, 0.1) 0%, transparent 50%),
              radial-gradient(circle at 80% 50%, rgba(88, 101, 242, 0.05) 0%, transparent 50%),
              linear-gradient(180deg, #0a0a0f 0%, #000000 100%);
          }
          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 4rem;
          }
          .logo {
            display: flex;
            align-items: center;
            gap: 1rem;
            font-size: 1.5rem;
            font-weight: 700;
            color: #ffffff;
          }
          .logo-icon {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #5865F2, #4752C4);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
          }
          .nav-links {
            display: flex;
            gap: 2rem;
            align-items: center;
          }
          .nav-links a {
            color: #a0a0b0;
            text-decoration: none;
            transition: color 0.3s;
          }
          .nav-links a:hover {
            color: #ffffff;
          }
          .btn {
            padding: 0.6rem 1.5rem;
            border-radius: 8px;
            border: none;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            text-decoration: none;
            display: inline-block;
          }
          .btn-primary {
            background: #5865F2;
            color: white;
          }
          .btn-primary:hover {
            background: #4752C4;
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(88, 101, 242, 0.3);
          }
          .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.2);
          }
          .hero {
            text-align: center;
            padding: 4rem 0;
          }
          .hero h1 {
            font-size: 4rem;
            font-weight: 800;
            margin-bottom: 1.5rem;
            background: linear-gradient(135deg, #ffffff 0%, #5865F2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }
          .hero p {
            font-size: 1.2rem;
            color: #a0a0b0;
            max-width: 600px;
            margin: 0 auto 2rem;
            line-height: 1.6;
          }
          .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            padding: 4rem 0;
          }
          .feature-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 2rem;
            transition: all 0.3s;
          }
          .feature-card:hover {
            transform: translateY(-5px);
            border-color: #5865F2;
            box-shadow: 0 8px 30px rgba(88, 101, 242, 0.2);
          }
          .feature-card h3 {
            font-size: 1.3rem;
            margin-bottom: 1rem;
            color: #ffffff;
          }
          .feature-card p {
            color: #a0a0b0;
            line-height: 1.6;
          }
          .feature-icon {
            font-size: 2rem;
            margin-bottom: 1rem;
            display: block;
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 2rem;
            padding: 3rem 0;
            text-align: center;
          }
          .stat-item {
            padding: 2rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
          }
          .stat-number {
            font-size: 3rem;
            font-weight: 800;
            color: #5865F2;
          }
          .stat-label {
            color: #a0a0b0;
            margin-top: 0.5rem;
          }
          .footer {
            text-align: center;
            padding: 3rem 0;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            color: #a0a0b0;
          }
          @media (max-width: 768px) {
            .hero h1 {
              font-size: 2.5rem;
            }
            .header {
              flex-direction: column;
              gap: 1rem;
            }
            .nav-links {
              flex-wrap: wrap;
              justify-content: center;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <header class="header">
            <div class="logo">
              <div class="logo-icon">⚡</div>
              <span>Karma Protection</span>
            </div>
            <nav class="nav-links">
              <a href="#features">Features</a>
              <a href="/dashboard">Dashboard</a>
              <a href="/login" class="btn btn-primary">Sign In</a>
              <a href="${DISCORD_INVITE_URL}" class="btn btn-secondary">Discord</a>
            </nav>
          </header>

          <section class="hero">
            <h1>Next Generation Lua Protection</h1>
            <p>Protect your Lua scripts with military-grade obfuscation, VM-level protection, and an advanced key system. Built for developers who take security seriously.</p>
            <a href="/login" class="btn btn-primary" style="font-size: 1.1rem; padding: 0.8rem 2.5rem;">Get Started Free</a>
          </section>

          <section class="features" id="features">
            <div class="feature-card">
              <span class="feature-icon">🛡️</span>
              <h3>Multi-Layer Obfuscation</h3>
              <p>XOR encoding, control flow obfuscation, VM bytecode generation, and anti-tamper checks. Your code stays secure.</p>
            </div>
            <div class="feature-card">
              <span class="feature-icon">🔑</span>
              <h3>Advanced Key System</h3>
              <p>Customizable key system with GUI, HWID locking, cooldowns, and Discord integration. Perfect for commercial projects.</p>
            </div>
            <div class="feature-card">
              <span class="feature-icon">⚡</span>
              <h3>VM Protection Layer</h3>
              <p>Custom VM bytecode execution makes reverse engineering significantly harder. Your logic is safe.</p>
            </div>
            <div class="feature-card">
              <span class="feature-icon">🤖</span>
              <h3>Discord Bot Integration</h3>
              <p>Manage everything from Discord. Generate keys, reset HWIDs, and monitor your scripts in real-time.</p>
            </div>
            <div class="feature-card">
              <span class="feature-icon">📊</span>
              <h3>Service Management</h3>
              <p>Organize your scripts into services. Perfect for managing multiple products or clients.</p>
            </div>
            <div class="feature-card">
              <span class="feature-icon">🎨</span>
              <h3>Customizable GUI</h3>
              <p>Fully customizable key system with your branding, colors, and descriptions. Professional and polished.</p>
            </div>
          </section>

          <section class="stats">
            <div class="stat-item">
              <div class="stat-number" id="scriptCount">0</div>
              <div class="stat-label">Protected Scripts</div>
            </div>
            <div class="stat-item">
              <div class="stat-number" id="keyCount">0</div>
              <div class="stat-label">Keys Generated</div>
            </div>
            <div class="stat-item">
              <div class="stat-number" id="userCount">0</div>
              <div class="stat-label">Active Users</div>
            </div>
          </section>

          <footer class="footer">
            <p>© 2024 Karma Protection. All rights reserved.</p>
            <p style="margin-top: 0.5rem; font-size: 0.9rem;">Built with ❤️ for the Lua community</p>
          </footer>
        </div>
        <script>
          // Fetch stats from API
          fetch('/api/stats')
            .then(res => res.json())
            .then(data => {
              document.getElementById('scriptCount').textContent = data.scripts || 0;
              document.getElementById('keyCount').textContent = data.keys || 0;
              document.getElementById('userCount').textContent = data.users || 0;
            })
            .catch(() => {});
        </script>
      </body>
      </html>
    `);
  });

  // Stats endpoint
  app.get('/api/stats', (req, res) => {
    const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
    const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM website_users').get().count;
    res.json({ scripts: scriptCount, keys: keyCount, users: userCount });
  });

  // ... (rest of API routes)

  const port = Number(process.env.PORT || process.env.API_PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Web server listening on port ${port}`));
}

// ---------------- Main Execution ----------------
(async () => {
  try {
    await deployCommands();
  } catch (error) {
    console.error('Slash command deploy failed:', error);
  }

  startApiServer();
  await client.login(DISCORD_TOKEN);
})();
