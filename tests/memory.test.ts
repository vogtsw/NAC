/**
 * Memory System Tests
 * Tests for SessionDB (SQLite-based session store with FTS5 search).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionDB } from "../src/memory/session-db.js";
import { rmSync, mkdirSync } from "fs";
import { join } from "path";

const testDir = join(process.cwd(), "test-db");

describe("SessionDB", () => {
  let db: SessionDB;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    db = new SessionDB(testDir);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ── Session Operations ──────────────────────────────────

  it("creates and retrieves a session", () => {
    const session = db.createSession("s1", { userId: "user1" });
    expect(session.id).toBe("s1");
    expect(session.status).toBe("active");
    expect(session.metadata.userId).toBe("user1");

    const retrieved = db.getSession("s1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("s1");
  });

  it("supports parent-child session lineage", () => {
    const parent = db.createSession("parent");
    const child = db.createSession("child", {}, "parent");

    expect(child.parentSessionId).toBe("parent");

    const retrieved = db.getSession("child");
    expect(retrieved!.parentSessionId).toBe("parent");
  });

  it("updates session status", () => {
    db.createSession("s1");
    db.updateSessionStatus("s1", "completed");

    const session = db.getSession("s1");
    expect(session!.status).toBe("completed");
  });

  it("lists sessions ordered by update time", () => {
    db.createSession("s1");
    db.createSession("s2");
    db.createSession("s3");

    const sessions = db.listSessions();
    expect(sessions).toHaveLength(3);
    // Most recently updated first
    expect(sessions[0].id).toBe("s3");
  });

  it("deletes a session", () => {
    db.createSession("s1");
    db.deleteSession("s1");
    expect(db.getSession("s1")).toBeNull();
  });

  // ── Message Operations ──────────────────────────────────

  it("adds and retrieves messages", () => {
    db.createSession("s1");
    db.addMessage("s1", { role: "user", content: "Hello", timestamp: Date.now() });
    db.addMessage("s1", { role: "assistant", content: "Hi there!", timestamp: Date.now() });

    const messages = db.getMessages("s1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hi there!");
  });

  it("handles structured message content", () => {
    db.createSession("s1");
    db.addMessage("s1", {
      role: "assistant",
      content: [{ type: "text", text: "test" }],
      timestamp: Date.now(),
    });

    const messages = db.getMessages("s1");
    expect(messages).toHaveLength(1);
    const content = messages[0].content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("test");
  });

  it("counts messages in a session", () => {
    db.createSession("s1");
    for (let i = 0; i < 5; i++) {
      db.addMessage("s1", { role: "user", content: `msg ${i}`, timestamp: Date.now() });
    }
    expect(db.getMessageCount("s1")).toBe(5);
  });

  it("respects message limit", () => {
    db.createSession("s1");
    for (let i = 0; i < 10; i++) {
      db.addMessage("s1", { role: "user", content: `msg ${i}`, timestamp: Date.now() });
    }
    const limit = 3;
    const messages = db.getMessages("s1", limit);
    // Should return the most recent messages up to the limit
    expect(messages.length).toBeLessThanOrEqual(limit);
  });

  // ── Full-Text Search ───────────────────────────────────

  it("searches messages with FTS5", () => {
    db.createSession("s1");
    db.addMessage("s1", {
      role: "user",
      content: "How do I implement a binary search tree in TypeScript?",
      timestamp: Date.now(),
    });
    db.addMessage("s1", {
      role: "assistant",
      content: "Here's how to implement a binary search tree...",
      timestamp: Date.now(),
    });

    // Wait a moment for FTS to index
    const results = db.searchMessages("binary search tree");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.content.includes("binary search"))).toBe(true);
  });

  it("searches across multiple sessions", () => {
    db.createSession("s1");
    db.createSession("s2");
    db.addMessage("s1", { role: "user", content: "React component tutorial", timestamp: Date.now() });
    db.addMessage("s2", { role: "user", content: "React hooks guide", timestamp: Date.now() });

    const results = db.searchMessages("React");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("searchSessions returns full session objects", () => {
    db.createSession("react-session");
    db.addMessage("react-session", {
      role: "user",
      content: "React state management patterns",
      timestamp: Date.now(),
    });

    const sessions = db.searchSessions("state management");
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].id).toBe("react-session");
  });

  // ── Memory Entry Operations ─────────────────────────────

  it("adds and retrieves memory entries", () => {
    db.addMemory({
      id: "mem1",
      type: "fact",
      content: "User prefers TypeScript over JavaScript",
      source: "session-s1",
      confidence: 0.9,
      createdAt: Date.now(),
      tags: ["preference", "language"],
    });

    const memory = db.getMemory("mem1");
    expect(memory).not.toBeNull();
    expect(memory!.type).toBe("fact");
    expect(memory!.content).toContain("TypeScript");
  });

  it("tracks memory access", () => {
    db.addMemory({
      id: "mem1",
      type: "preference",
      content: "User likes dark mode",
      source: "session-s1",
      confidence: 1.0,
      createdAt: Date.now(),
      tags: ["ui"],
    });

    db.getMemory("mem1");
    db.getMemory("mem1");

    const memory = db.getMemory("mem1");
    expect(memory!.accessCount).toBeGreaterThanOrEqual(2);
  });

  it("searches memories by content", () => {
    db.addMemory({
      id: "m1",
      type: "fact",
      content: "Project uses React 19 with TypeScript 5.7",
      source: "session-s1",
      confidence: 0.95,
      createdAt: Date.now(),
      tags: ["tech-stack"],
    });
    db.addMemory({
      id: "m2",
      type: "fact",
      content: "Database is PostgreSQL 16",
      source: "session-s2",
      confidence: 0.9,
      createdAt: Date.now(),
      tags: ["tech-stack"],
    });

    const results = db.searchMemory("React");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("React");
  });

  it("filters memories by type", () => {
    db.addMemory({
      id: "f1",
      type: "fact",
      content: "Test fact",
      source: "test",
      confidence: 1.0,
      createdAt: Date.now(),
      tags: [],
    });
    db.addMemory({
      id: "p1",
      type: "preference",
      content: "Test preference",
      source: "test",
      confidence: 1.0,
      createdAt: Date.now(),
      tags: [],
    });

    const facts = db.searchMemory("Test", "fact");
    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe("fact");
  });

  it("generates injection-ready memory text", () => {
    db.addMemory({
      id: "mem1",
      type: "preference",
      content: "User prefers concise code comments",
      source: "s1",
      confidence: 0.9,
      createdAt: Date.now(),
      tags: [],
    });

    const text = db.getMemoriesForInjection();
    expect(text).toContain("concise code comments");
    expect(text).toContain("preference");
  });

  it("deletes a memory entry", () => {
    db.addMemory({
      id: "to-delete",
      type: "fact",
      content: "Will be deleted",
      source: "test",
      confidence: 0.5,
      createdAt: Date.now(),
      tags: [],
    });

    db.deleteMemory("to-delete");
    expect(db.getMemory("to-delete")).toBeNull();
  });

  // ── Statistics ──────────────────────────────────────────

  it("returns correct stats", () => {
    db.createSession("s1");
    db.addMessage("s1", { role: "user", content: "test", timestamp: Date.now() });
    db.addMemory({
      id: "m1",
      type: "fact",
      content: "test",
      source: "test",
      confidence: 1.0,
      createdAt: Date.now(),
      tags: [],
    });

    const stats = db.getStats();
    expect(stats.sessionCount).toBe(1);
    expect(stats.messageCount).toBe(1);
    expect(stats.memoryCount).toBe(1);
    expect(stats.dbSize).toContain("MB");
  });
});
