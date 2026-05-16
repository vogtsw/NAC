/**
 * Blackboard Typed Artifact API Tests
 * Phase 6: putArtifact, getArtifact, listArtifacts, linkArtifactConsumer, validateArtifact, getArtifactCompleteness
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Blackboard } from "../src/state/Blackboard.js";

describe("Blackboard Artifact API", () => {
  let bb: Blackboard;

  beforeEach(async () => {
    process.env.USE_MEMORY_STORE = "true";
    bb = new Blackboard("redis://localhost:6379");
    await bb.initialize();
  });

  afterEach(async () => {
    await bb.close();
  });

  it("stores and retrieves an artifact", async () => {
    await bb.createSession("run1", {});
    await bb.putArtifact({
      id: "artifact-1",
      runId: "run1",
      type: "plan",
      producer: "PlannerAgent",
      consumers: ["ResearchAgent"],
      content: { goal: "Test", steps: [] },
      confidence: 0.95,
    });

    const artifact = await bb.getArtifact("run1", "artifact-1");
    expect(artifact).toBeDefined();
    expect(artifact.type).toBe("plan");
    expect(artifact.producer).toBe("PlannerAgent");
    expect(artifact.confidence).toBe(0.95);
    expect(artifact.createdAt).toBeGreaterThan(0);
  });

  it("lists artifacts filtered by type", async () => {
    await bb.createSession("run2", {});
    await bb.putArtifact({ id: "a1", runId: "run2", type: "plan", producer: "P", content: {} });
    await bb.putArtifact({ id: "a2", runId: "run2", type: "patch", producer: "C", content: {} });
    await bb.putArtifact({ id: "a3", runId: "run2", type: "plan", producer: "P2", content: {} });

    const plans = await bb.listArtifacts("run2", { type: "plan" });
    expect(plans.length).toBe(2);

    const all = await bb.listArtifacts("run2");
    expect(all.length).toBe(3);
  });

  it("lists artifacts filtered by producer", async () => {
    await bb.createSession("run3", {});
    await bb.putArtifact({ id: "a1", runId: "run3", type: "file_summary", producer: "ResearchAgent#1", content: {} });
    await bb.putArtifact({ id: "a2", runId: "run3", type: "file_summary", producer: "ResearchAgent#2", content: {} });

    const r1 = await bb.listArtifacts("run3", { producer: "ResearchAgent#1" });
    expect(r1.length).toBe(1);
  });

  it("links a consumer to an artifact", async () => {
    await bb.createSession("run4", {});
    await bb.putArtifact({ id: "a1", runId: "run4", type: "plan", producer: "P", consumers: ["R1"], content: {} });

    const linked = await bb.linkArtifactConsumer("run4", "a1", "R2");
    expect(linked).toBe(true);

    const artifact = await bb.getArtifact("run4", "a1");
    expect(artifact.consumers).toContain("R1");
    expect(artifact.consumers).toContain("R2");
  });

  it("returns null for non-existent artifact", async () => {
    await bb.createSession("run5", {});
    const result = await bb.getArtifact("run5", "nonexistent");
    expect(result).toBeNull();
  });

  it("throws for artifact in non-existent session", async () => {
    await expect(bb.putArtifact({
      id: "a1", runId: "no-such-run", type: "plan", producer: "P", content: {},
    })).rejects.toThrow("not found");
  });

  it("validates artifact schema", () => {
    const valid = bb.validateArtifact({ id: "a1", type: "plan", producer: "P" }, "plan");
    expect(valid.valid).toBe(true);

    const wrongType = bb.validateArtifact({ id: "a1", type: "patch", producer: "P" }, "plan");
    expect(wrongType.valid).toBe(false);
    expect(wrongType.issues.length).toBeGreaterThan(0);
  });

  it("calculates artifact completeness", async () => {
    await bb.createSession("run6", {});
    await bb.putArtifact({ id: "a1", runId: "run6", type: "plan", producer: "P", content: {} });
    await bb.putArtifact({ id: "a2", runId: "run6", type: "repo_context", producer: "R", content: {} });
    await bb.putArtifact({ id: "a3", runId: "run6", type: "patch", producer: "C", content: {} });
    await bb.putArtifact({ id: "a4", runId: "run6", type: "test_report", producer: "T", content: {} });

    const metrics = await bb.getArtifactCompleteness("run6");
    expect(metrics.total).toBe(4);
    expect(metrics.byType.plan).toBe(1);
    expect(metrics.completeness).toBeGreaterThan(0.5); // 4/6 expected types
  });

  it("artifact createdAt timestamp is set", async () => {
    await bb.createSession("run7", {});
    await bb.putArtifact({ id: "a1", runId: "run7", type: "final_answer", producer: "Coordinator", content: {} });
    const artifact = await bb.getArtifact("run7", "a1");
    expect(artifact.createdAt).toBeGreaterThan(Date.now() - 10000);
  });

  it("default consumers is empty array", async () => {
    await bb.createSession("run8", {});
    await bb.putArtifact({ id: "a1", runId: "run8", type: "plan", producer: "P", content: {} });
    const artifact = await bb.getArtifact("run8", "a1");
    expect(Array.isArray(artifact.consumers)).toBe(true);
    expect(artifact.consumers.length).toBe(0);
  });
});
