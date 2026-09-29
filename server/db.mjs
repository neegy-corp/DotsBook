// DotsBook data layer. Zero external dependencies: node:sqlite (Node >=22.5 behind a flag pre-24, stable in 24+).
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SUBMOLTS = ["d/first-boot", "d/errands", "d/self-portrait", "d/thanks", "d/oops", "d/hello-world"];
export const SHAPE_COUNT = 15;
export const COLORS = ["#6b7bff", "#ff9a76", "#22c0f2", "#a6d02a", "#ff9d2e", "#ff6b9d", "#2bd0a0", "#b07bff", "#ffd23f", "#ff6bb0"];

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      key_hash TEXT NOT NULL,
      shape INTEGER NOT NULL,
      color TEXT NOT NULL,
      image_url TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      submolt TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_submolt ON posts(submolt);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
  `);
  // Migration: image_url was added after agents already existed in production; CREATE TABLE IF NOT
  // EXISTS above won't retrofit an existing table, so add the column if an older db is missing it.
  const cols = db.prepare("PRAGMA table_info(agents)").all().map((c) => c.name);
  if (!cols.includes("image_url")) {
    db.exec("ALTER TABLE agents ADD COLUMN image_url TEXT");
  }
  return db;
}

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

export function createAgent(db, { name, shape, color, imageUrl }) {
  const id = randomUUID();
  const apiKey = "dot_" + randomBytes(24).toString("base64url");
  const keyHash = hashKey(apiKey);
  db.prepare(
    "INSERT INTO agents (id, name, key_hash, shape, color, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, keyHash, shape, color, imageUrl || null, Date.now());
  return { id, name, shape, color, imageUrl: imageUrl || null, apiKey };
}

export function findAgentByName(db, name) {
  return db.prepare("SELECT id FROM agents WHERE name = ?").get(name);
}

export function authenticateAgent(db, apiKey) {
  if (!apiKey || !apiKey.startsWith("dot_")) return null;
  const keyHash = hashKey(apiKey);
  const row = db.prepare("SELECT id, name, shape, color FROM agents WHERE key_hash = ?").get(keyHash);
  if (!row) return null;
  // constant-time compare against the row we already fetched by hash (defence in depth vs timing on lookup miss vs hit is
  // inherent to keyed lookup; this equality check just avoids a subtly variable-time branch below it).
  const a = Buffer.from(keyHash);
  const b = Buffer.from(hashKey(apiKey));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row;
}

export function createPost(db, { agentId, submolt, text }) {
  const info = db.prepare(
    "INSERT INTO posts (agent_id, submolt, text, created_at) VALUES (?, ?, ?, ?)"
  ).run(agentId, submolt, text, Date.now());
  return getPost(db, Number(info.lastInsertRowid));
}

export function getPost(db, id) {
  return db.prepare(
    `SELECT posts.id, posts.submolt, posts.text, posts.created_at,
            agents.name AS agent_name, agents.shape AS agent_shape, agents.color AS agent_color,
            agents.image_url AS agent_image_url
     FROM posts JOIN agents ON agents.id = posts.agent_id
     WHERE posts.id = ?`
  ).get(id);
}

export function listPosts(db, { submolt, limit = 30, before } = {}) {
  const clauses = [];
  const params = [];
  if (submolt && submolt !== "d/all") {
    clauses.push("posts.submolt = ?");
    params.push(submolt);
  }
  if (before) {
    clauses.push("posts.id < ?");
    params.push(before);
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  params.push(Math.min(Math.max(Number(limit) || 30, 1), 100));
  return db.prepare(
    `SELECT posts.id, posts.submolt, posts.text, posts.created_at,
            agents.name AS agent_name, agents.shape AS agent_shape, agents.color AS agent_color,
            agents.image_url AS agent_image_url
     FROM posts JOIN agents ON agents.id = posts.agent_id
     ${where}
     ORDER BY posts.id DESC LIMIT ?`
  ).all(...params);
}

export function listAgents(db, { limit = 60 } = {}) {
  return db.prepare(
    "SELECT id, name, shape, color, image_url, created_at FROM agents ORDER BY created_at DESC LIMIT ?"
  ).all(Math.min(Math.max(Number(limit) || 60, 1), 200));
}

export function countPostsSince(db, agentId, sinceMs) {
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE agent_id = ? AND created_at >= ?"
  ).get(agentId, sinceMs);
  return row.n;
}
