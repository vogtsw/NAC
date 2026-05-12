/**
 * SessionDB — JSON-file-based session persistence with text search.
 * Inspired by Hermes Agent's SessionDB (hermes_state.py).
 *
 * Uses plain JSON files instead of SQLite to avoid native compilation
 * requirements (better-sqlite3 needs node-gyp / Visual Studio on Windows).
 *
 * Features:
 * - Store conversation sessions with full message history
 * - Text search across sessions (in-memory index)
 * - Parent-child session lineage (for compressed sessions)
 * - Memory entry storage for long-term facts
 * - Atomic writes via temp-file + rename
 */

import type { Message, SessionState, MemoryEntry } from "../agent/types.js";
import { join } from "path";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
  renameSync,
} from "fs";

// ── In-memory search index ───────────────────────────────

interface SearchEntry {
  sessionId: string;
  role: string;
  content: string;
  timestamp: number;
}

class SearchIndex {
  private entries: SearchEntry[] = [];

  add(sessionId: string, role: string, content: string, timestamp: number): void {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    this.entries.push({ sessionId, role, content: text, timestamp });
  }

  search(query: string, limit: number = 50): Array<SearchEntry & { rank: number }> {
    const terms = query.toLowerCase().split(/\s+/);
    const scored = this.entries
      .map((entry) => {
        const contentLower = entry.content.toLowerCase();
        let score = 0;
        for (const term of terms) {
          const count = (contentLower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
          score += count;
        }
        return { ...entry, rank: score };
      })
      .filter((e) => e.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);

    return scored;
  }

  removeSession(sessionId: string): void {
    this.entries = this.entries.filter((e) => e.sessionId !== sessionId);
  }

  clear(): void {
    this.entries = [];
  }
}

// ── Memory Index ─────────────────────────────────────────

class MemoryIndex {
  private entries: Map<string, MemoryEntry> = new Map();

  set(entry: MemoryEntry): void {
    this.entries.set(entry.id, entry);
  }

  get(id: string): MemoryEntry | undefined {
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessedAt = Date.now();
    }
    return entry;
  }

  search(query: string, type?: string, limit: number = 20): MemoryEntry[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.entries.values())
      .filter((e) => {
        const match = e.content.toLowerCase().includes(lowerQuery);
        if (type && e.type !== type) return false;
        return match;
      })
      .sort((a, b) => b.confidence - a.confidence || b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, limit);
  }

  recent(limit: number = 20): MemoryEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, limit);
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }

  entries_iter(): IterableIterator<MemoryEntry> {
    return this.entries.values();
  }
}

// ── SessionDB ────────────────────────────────────────────

export class SessionDB {
  private dir: string;
  private sessionsDir: string;
  private memoryDir: string;
  private searchIndex: SearchIndex;
  private memoryIndex: MemoryIndex;

  constructor(dbPath?: string) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
    this.dir = dbPath || join(homeDir, ".jiqun");
    this.sessionsDir = join(this.dir, "sessions");
    this.memoryDir = join(this.dir, "memory");

    for (const d of [this.dir, this.sessionsDir, this.memoryDir]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }

    this.searchIndex = new SearchIndex();
    this.memoryIndex = new MemoryIndex();
    this.loadFromDisk();
  }

  // ── Load existing data ─────────────────────────────────

  private loadFromDisk(): void {
    try {
      // Load memory entries
      const memFiles = readdirSync(this.memoryDir).filter((f) => f.endsWith(".json"));
      for (const file of memFiles) {
        try {
          const data = JSON.parse(readFileSync(join(this.memoryDir, file), "utf-8"));
          this.memoryIndex.set(data);
        } catch {
          // skip corrupt files
        }
      }

      // Load session messages into search index
      const sessionFiles = readdirSync(this.sessionsDir).filter((f) => f.endsWith(".json"));
      for (const file of sessionFiles) {
        try {
          const session = JSON.parse(readFileSync(join(this.sessionsDir, file), "utf-8"));
          for (const msg of session.messages || []) {
            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            this.searchIndex.add(session.id, msg.role, content, msg.timestamp || session.createdAt);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // directory might be empty
    }
  }

  // ── Session Operations ─────────────────────────────────

  createSession(
    id: string,
    metadata: Record<string, unknown> = {},
    parentSessionId?: string
  ): SessionState {
    const now = Date.now();
    const session: SessionState = {
      id,
      status: "active",
      parentSessionId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata,
    };
    this.writeSession(session);
    return session;
  }

  getSession(id: string): SessionState | null {
    const path = this.sessionPath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }

  updateSessionStatus(id: string, status: SessionState["status"]): void {
    const session = this.getSession(id);
    if (!session) return;
    session.status = status;
    session.updatedAt = Date.now();
    this.writeSession(session);
  }

  listSessions(limit: number = 50, offset: number = 0): SessionState[] {
    try {
      const files = readdirSync(this.sessionsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const path = join(this.sessionsDir, f);
          const stat = statSync(path);
          return { file: f, mtime: stat.mtimeMs, path };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(offset, offset + limit);

      return files
        .map((f) => {
          try {
            return JSON.parse(readFileSync(f.path, "utf-8")) as SessionState;
          } catch {
            return null;
          }
        })
        .filter((s): s is SessionState => s !== null);
    } catch {
      return [];
    }
  }

  deleteSession(id: string): void {
    const path = this.sessionPath(id);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore
    }
    this.searchIndex.removeSession(id);
  }

  // ── Message Operations ─────────────────────────────────

  addMessage(sessionId: string, message: Message): number {
    const session = this.getSession(sessionId);
    if (!session) {
      this.createSession(sessionId);
    }

    const now = Date.now();
    const msg: Message = { ...message, timestamp: message.timestamp || now };

    const s = this.getSession(sessionId);
    if (!s) return -1;

    s.messages.push(msg);
    s.updatedAt = now;
    this.writeSession(s);

    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    this.searchIndex.add(sessionId, msg.role, content, msg.timestamp || now);

    return s.messages.length;
  }

  getMessages(sessionId: string, limit: number = 500): Message[] {
    const session = this.getSession(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
  }

  getMessageCount(sessionId: string): number {
    const session = this.getSession(sessionId);
    return session ? session.messages.length : 0;
  }

  // ── Text Search ────────────────────────────────────────

  searchMessages(query: string, limit: number = 50): Array<{
    sessionId: string;
    role: string;
    content: string;
    timestamp: number;
    rank: number;
  }> {
    return this.searchIndex.search(query, limit);
  }

  searchSessions(query: string, limit: number = 20): SessionState[] {
    const results = this.searchMessages(query, limit);
    const sessionIds = [...new Set(results.map((r) => r.sessionId))];
    return sessionIds
      .map((id) => this.getSession(id))
      .filter((s): s is SessionState => s !== null);
  }

  // ── Memory Entry Operations ────────────────────────────

  addMemory(entry: Omit<MemoryEntry, "lastAccessedAt" | "accessCount">): void {
    const fullEntry: MemoryEntry = {
      ...entry,
      lastAccessedAt: Date.now(),
      accessCount: 0,
    };
    this.memoryIndex.set(fullEntry);
    this.writeMemoryEntry(fullEntry);
  }

  getMemory(id: string): MemoryEntry | null {
    return this.memoryIndex.get(id) || null;
  }

  searchMemory(
    query: string,
    type?: MemoryEntry["type"],
    limit: number = 20
  ): MemoryEntry[] {
    return this.memoryIndex.search(query, type, limit);
  }

  getRecentMemories(limit: number = 20): MemoryEntry[] {
    return this.memoryIndex.recent(limit);
  }

  getMemoriesForInjection(limit: number = 10): string {
    const memories = this.memoryIndex.recent(limit);
    if (memories.length === 0) return "";
    return memories
      .map((m) => `[${m.type}] ${m.content} (confidence: ${m.confidence.toFixed(2)})`)
      .join("\n");
  }

  deleteMemory(id: string): void {
    this.memoryIndex.delete(id);
    const path = join(this.memoryDir, `${id}.json`);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore
    }
  }

  // ── Helpers ────────────────────────────────────────────

  private sessionPath(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  private writeSession(session: SessionState): void {
    const tmp = this.sessionPath(session.id) + ".tmp";
    writeFileSync(tmp, JSON.stringify(session, null, 2), "utf-8");
    renameSync(tmp, this.sessionPath(session.id));
  }

  private writeMemoryEntry(entry: MemoryEntry): void {
    const path = join(this.memoryDir, `${entry.id}.json`);
    writeFileSync(path, JSON.stringify(entry, null, 2), "utf-8");
  }

  close(): void {
    // JSON files don't need explicit closing
  }

  getStats(): {
    sessionCount: number;
    messageCount: number;
    memoryCount: number;
    dbSize: string;
  } {
    let sessionCount = 0;
    let messageCount = 0;
    let totalSize = 0;

    try {
      const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith(".json"));
      sessionCount = files.length;
      for (const file of files) {
        const path = join(this.sessionsDir, file);
        totalSize += statSync(path).size;
        try {
          const session = JSON.parse(readFileSync(path, "utf-8"));
          messageCount += (session.messages || []).length;
        } catch {
          // skip
        }
      }
    } catch {
      // directory empty
    }

    try {
      const memFiles = readdirSync(this.memoryDir).filter((f) => f.endsWith(".json"));
      for (const file of memFiles) {
        const path = join(this.memoryDir, file);
        totalSize += statSync(path).size;
      }
    } catch {
      // directory empty
    }

    return {
      sessionCount,
      messageCount,
      memoryCount: this.memoryIndex.size,
      dbSize: `${(totalSize / (1024 * 1024)).toFixed(2)} MB`,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────

let defaultDb: SessionDB | null = null;

export function getSessionDB(dbPath?: string): SessionDB {
  if (!defaultDb) {
    defaultDb = new SessionDB(dbPath);
  }
  return defaultDb;
}

export function closeSessionDB(): void {
  if (defaultDb) {
    defaultDb.close();
    defaultDb = null;
  }
}
