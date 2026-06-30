import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const nowIso = () => new Date().toISOString();

function rowToScript(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_id: row.owner_id,
    guild_id: row.guild_id,
    name: row.name,
    content: row.content,
    is_public: Boolean(row.is_public),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function rowToKey(row) {
  if (!row) return null;
  return {
    key: row.key,
    script_id: row.script_id,
    owner_id: row.owner_id,
    discord_id: row.discord_id,
    hwid: row.hwid,
    expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    max_uses: row.max_uses,
    uses: Number(row.uses ?? 0),
    active: Boolean(row.active),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class PostgresStore {
  constructor() {
    const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        guild_id TEXT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        is_public BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS license_keys (
        key TEXT PRIMARY KEY,
        script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        discord_id TEXT,
        hwid TEXT,
        expires_at TIMESTAMPTZ,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_scripts_owner ON scripts(owner_id);
      CREATE INDEX IF NOT EXISTS idx_keys_script ON license_keys(script_id);
      CREATE INDEX IF NOT EXISTS idx_keys_owner ON license_keys(owner_id);
    `);
  }

  async close() {
    await this.pool.end();
  }

  async createScript(script) {
    const result = await this.pool.query(
      `INSERT INTO scripts (id, owner_id, guild_id, name, content, is_public)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [script.id, script.owner_id, script.guild_id, script.name, script.content, script.is_public]
    );
    return rowToScript(result.rows[0]);
  }

  async getScript(id) {
    const result = await this.pool.query('SELECT * FROM scripts WHERE id = $1', [id]);
    return rowToScript(result.rows[0]);
  }

  async listScripts(ownerId) {
    const result = await this.pool.query(
      `SELECT id, owner_id, guild_id, name, is_public, created_at, updated_at,
              LENGTH(content) AS content_bytes
       FROM scripts WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [ownerId]
    );
    return result.rows.map((row) => ({ ...rowToScript({ ...row, content: '' }), content_bytes: Number(row.content_bytes) }));
  }

  async deleteScript(id, ownerId) {
    const result = await this.pool.query('DELETE FROM scripts WHERE id = $1 AND owner_id = $2', [id, ownerId]);
    return result.rowCount > 0;
  }

  async createLicenseKey(license) {
    const result = await this.pool.query(
      `INSERT INTO license_keys (key, script_id, owner_id, expires_at, max_uses)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [license.key, license.script_id, license.owner_id, license.expires_at, license.max_uses]
    );
    return rowToKey(result.rows[0]);
  }

  async getLicenseKey(key) {
    const result = await this.pool.query('SELECT * FROM license_keys WHERE key = $1', [key]);
    return rowToKey(result.rows[0]);
  }

  async listLicenseKeys(scriptId, ownerId) {
    const result = await this.pool.query(
      `SELECT * FROM license_keys
       WHERE script_id = $1 AND owner_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [scriptId, ownerId]
    );
    return result.rows.map(rowToKey);
  }

  async redeemLicenseKey(key, discordId) {
    const existing = await this.getLicenseKey(key);
    if (!existing) return null;
    if (existing.discord_id && existing.discord_id !== discordId) return { ...existing, redeem_denied: true };

    const result = await this.pool.query(
      `UPDATE license_keys
       SET discord_id = COALESCE(discord_id, $2), updated_at = NOW()
       WHERE key = $1 RETURNING *`,
      [key, discordId]
    );
    return rowToKey(result.rows[0]);
  }

  async resetHwid(key, ownerId) {
    const result = await this.pool.query(
      `UPDATE license_keys SET hwid = NULL, updated_at = NOW()
       WHERE key = $1 AND owner_id = $2 RETURNING *`,
      [key, ownerId]
    );
    return rowToKey(result.rows[0]);
  }

  async deleteLicenseKey(key, ownerId) {
    const result = await this.pool.query('DELETE FROM license_keys WHERE key = $1 AND owner_id = $2', [key, ownerId]);
    return result.rowCount > 0;
  }

  async recordSuccessfulExecution(key, hwid) {
    const result = await this.pool.query(
      `UPDATE license_keys
       SET uses = uses + 1,
           hwid = COALESCE(hwid, $2),
           updated_at = NOW()
       WHERE key = $1 RETURNING *`,
      [key, hwid || null]
    );
    return rowToKey(result.rows[0]);
  }
}

class JsonStore {
  constructor() {
    this.filePath = process.env.DB_FILE || path.join(process.cwd(), 'data', 'db.json');
    this.data = { scripts: [], license_keys: [] };
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
      this.data.scripts ??= [];
      this.data.license_keys ??= [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  async close() {}

  async persist() {
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  async createScript(script) {
    const record = { ...script, created_at: nowIso(), updated_at: nowIso() };
    this.data.scripts.push(record);
    await this.persist();
    return record;
  }

  async getScript(id) {
    return this.data.scripts.find((script) => script.id === id) || null;
  }

  async listScripts(ownerId) {
    return this.data.scripts
      .filter((script) => script.owner_id === ownerId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50)
      .map((script) => ({ ...script, content: '', content_bytes: Buffer.byteLength(script.content || '', 'utf8') }));
  }

  async deleteScript(id, ownerId) {
    const before = this.data.scripts.length;
    this.data.scripts = this.data.scripts.filter((script) => !(script.id === id && script.owner_id === ownerId));
    this.data.license_keys = this.data.license_keys.filter((license) => license.script_id !== id || license.owner_id !== ownerId);
    await this.persist();
    return this.data.scripts.length !== before;
  }

  async createLicenseKey(license) {
    const record = { ...license, discord_id: null, hwid: null, uses: 0, active: true, created_at: nowIso(), updated_at: nowIso() };
    this.data.license_keys.push(record);
    await this.persist();
    return record;
  }

  async getLicenseKey(key) {
    return this.data.license_keys.find((license) => license.key === key) || null;
  }

  async listLicenseKeys(scriptId, ownerId) {
    return this.data.license_keys
      .filter((license) => license.script_id === scriptId && license.owner_id === ownerId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);
  }

  async redeemLicenseKey(key, discordId) {
    const license = await this.getLicenseKey(key);
    if (!license) return null;
    if (license.discord_id && license.discord_id !== discordId) return { ...license, redeem_denied: true };
    license.discord_id ||= discordId;
    license.updated_at = nowIso();
    await this.persist();
    return license;
  }

  async resetHwid(key, ownerId) {
    const license = this.data.license_keys.find((item) => item.key === key && item.owner_id === ownerId);
    if (!license) return null;
    license.hwid = null;
    license.updated_at = nowIso();
    await this.persist();
    return license;
  }

  async deleteLicenseKey(key, ownerId) {
    const before = this.data.license_keys.length;
    this.data.license_keys = this.data.license_keys.filter((license) => !(license.key === key && license.owner_id === ownerId));
    await this.persist();
    return this.data.license_keys.length !== before;
  }

  async recordSuccessfulExecution(key, hwid) {
    const license = await this.getLicenseKey(key);
    if (!license) return null;
    license.uses += 1;
    if (!license.hwid && hwid) license.hwid = hwid;
    license.updated_at = nowIso();
    await this.persist();
    return license;
  }
}

export function createStore() {
  return process.env.DATABASE_URL ? new PostgresStore() : new JsonStore();
}
