# Multi-Agent Collaboration Plan: Login API Implementation

> **Version:** 1.0  
> **Status:** Approved  
> **Last Updated:** 2025-07-17  

---

## 1. Overview

This document defines a structured multi-agent collaboration plan for implementing a **Login API** endpoint. The system uses three specialized agents — **AnalysisAgent**, **CodeAgent**, and **AutomationAgent** — that work in a sequential pipeline with clear handoffs, artifact contracts, and a conflict resolution protocol.

### 1.1 Goals

- Build a secure, production-grade login API (JWT-based authentication).
- Define clear boundaries between analysis, implementation, and testing.
- Ensure traceability via handoff artifacts.
- Resolve cross-agent disagreements via an escalation protocol.

### 1.2 High-Level Pipeline

```
[AnalysisAgent] ──(Spec Artifact)──→ [CodeAgent] ──(Code Artifact)──→ [AutomationAgent]
       │                                      │                              │
       └──── Review Feedback ────────────────┘                              │
       └──────────────────── Review Feedback ───────────────────────────────┘
```

---

## 2. Agent Roles & Responsibilities

### 2.1 AnalysisAgent

| Aspect | Detail |
|---|---|
| **Primary Role** | Requirements analysis, security review, spec authoring |
| **Scope** | Endpoints, data models, validation rules, threat model |
| **Deliverable** | `login-api-spec.md` — the formal specification artifact |
| **Tools Used** | `file_read`, `file_write`, `grep`, `glob`, `delegate` |

**Responsibilities:**

1. **Requirements Elicitation** — Parse user stories and derive functional/non-functional requirements for the login API.
2. **Data Modeling** — Define the `LoginRequest` and `LoginResponse` schemas (including all fields, types, constraints).
3. **Security Analysis** — Perform a lightweight threat model (OWASP Top 10 lens) for the login flow:
   - Brute-force protection
   - Password hashing requirements (bcrypt/argon2)
   - JWT token structure, expiry, and refresh strategy
   - Rate-limiting requirements
   - Input validation rules (email format, password constraints)
4. **Spec Authoring** — Produce a complete specification document that serves as the single source of truth for CodeAgent.
5. **Review Gate** — Review code produced by CodeAgent and test results from AutomationAgent for spec compliance.

### 2.2 CodeAgent

| Aspect | Detail |
|---|---|
| **Primary Role** | Implementation, code review, refactoring |
| **Scope** | API handler, service layer, DB queries, middleware |
| **Deliverable** | Source code files + `implementation-report.md` |
| **Tools Used** | `file_write`, `file_edit`, `grep`, `glob`, `bash` |

**Responsibilities:**

1. **Implementation** — Write the login endpoint handler, authentication service, JWT utilities, and middleware based on the spec from AnalysisAgent.
2. **Input Validation** — Implement validation logic matching the spec (email format, password rules, sanitization).
3. **Error Handling** — Implement structured error responses (invalid credentials, account locked, server error).
4. **Security Hardening** — Apply security measures from the spec (rate limiting, hashing, token signing).
5. **Self-Review** — Run linters, type checks, and basic static analysis before handoff.
6. **Artifact Generation** — Produce `implementation-report.md` listing all files changed/created, key design decisions, and any deviations from spec.

### 2.3 AutomationAgent

| Aspect | Detail |
|---|---|
| **Primary Role** | Testing, CI/CD, deployment verification |
| **Scope** | Unit tests, integration tests, end-to-end tests, pipeline scripts |
| **Deliverable** | Test files + `test-report.md` + CI pipeline config |
| **Tools Used** | `bash`, `file_write`, `file_edit`, `grep`, `glob` |

**Responsibilities:**

1. **Unit Testing** — Write unit tests for the auth service, JWT utilities, and validation functions.
2. **Integration Testing** — Write integration tests for the login endpoint (happy path, wrong password, missing fields, rate limiting).
3. **Security Testing** — Write tests for known attack vectors (SQL injection, XSS, token tampering, brute-force detection).
4. **CI/CD Pipeline** — Create or update pipeline configuration (GitHub Actions / GitLab CI) to run tests on every PR.
5. **Coverage Gate** — Enforce minimum code coverage threshold (≥ 80%).
6. **Test Report** — Produce `test-report.md` with coverage metrics, pass/fail summary, and any regressions found.

---

## 3. Handoff Artifacts (Contracts)

Each handoff between agents uses a **formal artifact** that acts as a contract. The receiving agent must validate the artifact before proceeding.

### 3.1 Handoff #1: AnalysisAgent → CodeAgent

**Artifact:** `login-api-spec.md`

```markdown
# Login API Specification

## Endpoints
- POST /api/v1/auth/login

## Request Schema (LoginRequest)
| Field    | Type   | Required | Constraints                     |
|----------|--------|----------|---------------------------------|
| email    | string | yes      | valid email format, max 255     |
| password | string | yes      | min 8, max 128, non-null        |

## Response Schema (LoginResponse)
| Field        | Type   | Description                     |
|--------------|--------|---------------------------------|
| accessToken  | string | JWT, expires in 15 min          |
| refreshToken | string | JWT, expires in 7 days          |
| expiresIn    | number | seconds until token expiry      |

## Error Codes
| HTTP Status | Code            | Description                     |
|-------------|-----------------|---------------------------------|
| 200         | OK              | Successful login                |
| 400         | VALIDATION_ERROR| Invalid input format            |
| 401         | INVALID_CREDS   | Wrong email or password         |
| 429         | RATE_LIMITED    | Too many attempts               |
| 500         | INTERNAL_ERROR  | Unexpected server error         |

## Security Rules
- Password hashing: bcrypt with cost factor 12
- JWT signing: RS256 with 2048-bit key
- Rate limit: 5 attempts per IP per minute
- Account lockout: after 10 failed attempts, 15 min cooldown
- All inputs must be sanitized (strip HTML, trim whitespace)
```

**Validation by CodeAgent:**  
CodeAgent MUST read this file and confirm all fields, constraints, and rules are implementable. If ambiguities exist, CodeAgent opens a **clarification issue** (see Section 5).

---

### 3.2 Handoff #2: CodeAgent → AutomationAgent

**Artifact:** `implementation-report.md`

```markdown
# Implementation Report

## Files Created/Modified
- src/routes/auth.ts          (login handler)
- src/services/authService.ts (business logic)
- src/utils/jwt.ts            (JWT sign/verify)
- src/middleware/rateLimiter.ts
- src/middleware/validate.ts   (input validation)
- src/models/user.ts          (user DB model)

## Key Decisions
- Used bcryptjs (pure JS) for portability
- RS256 keys stored in env vars (JWT_PRIVATE_KEY, JWT_PUBLIC_KEY)
- Rate limiter uses in-memory Map (single-node only)

## Deviations from Spec
- None (fully compliant)

## Lint/Type Check Status
- ESLint: 0 errors, 0 warnings
- TypeScript: no errors (strict mode)
```

**Validation by AutomationAgent:**  
AutomationAgent MUST verify that all files listed exist, that the implementation matches the original spec (not just the report), and that there are no obvious security flaws before writing tests.

---

### 3.3 Handoff #3: AutomationAgent → AnalysisAgent (Review Loop)

**Artifact:** `test-report.md`

```markdown
# Test Report

## Summary
- Total Tests: 42
- Passed: 40
- Failed: 2
- Coverage: 87%

## Failed Tests
1. test("rate limiter resets after cooldown") — assertion timeout
2. test("refresh token rotation") — token mismatch

## Coverage Gaps
- src/middleware/rateLimiter.ts: 62% (missed edge cases)

## CI Pipeline
- .github/workflows/test.yml created
- Pipeline passes on push to feature branch
```

**Validation by AnalysisAgent:**  
AnalysisAgent reviews the test report against the original spec. Any test failures or coverage gaps that indicate spec violations trigger the **conflict resolution protocol** (Section 5).

---

## 4. Execution Flow (Step-by-Step)

```
Phase 1 — Analysis
  [AnalysisAgent]
    1. Read user requirements
    2. Write login-api-spec.md
    3. Validate spec internally (self-review)
    4. Hand off to CodeAgent
     │
     ▼
Phase 2 — Implementation
  [CodeAgent]
    1. Read login-api-spec.md
    2. Validate spec completeness
    3. Implement all source files
    4. Run linters & type checks
    5. Write implementation-report.md
    6. Hand off to AutomationAgent
     │
     ▼
Phase 3 — Automation
  [AutomationAgent]
    1. Read login-api-spec.md + implementation-report.md
    2. Write unit/integration/security tests
    3. Run tests, measure coverage
    4. Configure CI pipeline
    5. Write test-report.md
    6. Hand off to AnalysisAgent for review
     │
     ▼
Phase 4 — Review & Closure
  [AnalysisAgent]
    1. Read test-report.md
    2. Cross-reference against login-api-spec.md
    3. If all pass → APPROVE → mark task complete
    4. If failures → initiate conflict resolution (Section 5)
```

---

## 5. Conflict Resolution Protocol

Conflicts arise when one agent disagrees with another's output. The following protocol ensures disputes are resolved systematically.

### 5.1 Types of Conflicts

| Type | Description | Typical Trigger |
|---|---|---|
| **Spec Ambiguity** | CodeAgent cannot implement because spec is unclear | Missing field constraints, undefined behavior |
| **Spec Violation** | CodeAgent deviates from spec without justification | Implementation does not match spec |
| **Test Failure** | AutomationAgent finds failing tests | Code defect or spec ambiguity |
| **Security Finding** | Any agent identifies a vulnerability | Weak crypto, missing validation, exposed secrets |
| **Coverage Gap** | AutomationAgent reports below-threshold coverage | Untested code paths |

### 5.2 Resolution Ladder

```
Level 0 — Direct Resolution (within same agent)
  └─ Agent self-corrects before handoff (e.g., CodeAgent fixes lint errors)

Level 1 — Peer Negotiation (between two agents)
  └─ Agents exchange structured feedback via artifacts
  └─ Each agent produces a "disposition" comment on the conflict
  └─ If resolved → proceed; if not → escalate to Level 2

Level 2 — Triangulation (three-agent review)
  └─ All three agents review the conflict artifact simultaneously
  └─ Each agent produces an independent opinion
  └─ Majority vote decides the outcome
  └─ Tie → AnalysisAgent gets tie-breaking vote (spec authority)

Level 3 — Human Escalation
  └─ If Level 2 fails or security-critical issue found
  └─ A human developer is flagged with a summary artifact
  └─ Human decision is final and documented in the spec
```

### 5.3 Conflict Artifact Template

When any conflict is escalated, the initiating agent creates a `conflict-<id>.md` file:

```markdown
# Conflict Report — ID: C001

## Initiator
CodeAgent

## Type
Spec Ambiguity

## Description
The spec defines "password max 128" but does not specify whether
to truncate or reject passwords longer than 128 characters.

## Proposed Resolution (CodeAgent)
Reject with VALIDATION_ERROR if password > 128 chars.

## Counter-Proposal (if any)
N/A

## Resolution
[To be filled after Level 1/2/3 resolution]

## Verdict
[APPROVED / REJECTED / ESCALATED]
```

### 5.4 Escalation Examples

| Scenario | Level | Resolution |
|---|---|---|
| CodeAgent finds ambiguous field type | L1 | CodeAgent asks AnalysisAgent; spec is updated |
| AutomationAgent finds test failure | L1 | CodeAgent fixes bug; tests re-run |
| CodeAgent wants to use a different hashing algorithm | L2 | Three-agent vote; security analysis decides |
| AutomationAgent finds a hardcoded secret | L3 | Immediate human escalation (security hotfix) |

---

## 6. Artifact Directory Structure

All handoff artifacts are stored in a structured directory:

```
docs/
├── login-api-spec.md              ← AnalysisAgent → CodeAgent
├── implementation-report.md        ← CodeAgent → AutomationAgent
├── test-report.md                  ← AutomationAgent → AnalysisAgent
└── conflicts/
    ├── C001-spec-ambiguity.md
    └── C002-rate-limit-edge-case.md
```

---

## 7. Success Criteria

The plan is considered complete and successful when:

1. ✅ `login-api-spec.md` is written and validated by AnalysisAgent.
2. ✅ All source files are implemented by CodeAgent with zero lint/type errors.
3. ✅ All tests pass with ≥ 80% coverage (AutomationAgent).
4. ✅ CI pipeline is configured and green.
5. ✅ No unresolved conflicts remain at Level 2 or above.
6. ✅ AnalysisAgent gives final approval after reviewing test-report.md.

---

## 8. Appendix: Quick Reference Card

| Step | Agent | Input | Output | Gate |
|---|---|---|---|---|
| 1 | AnalysisAgent | Requirements | `login-api-spec.md` | Self-review |
| 2 | CodeAgent | `login-api-spec.md` | Source files + `implementation-report.md` | Lint/type pass |
| 3 | AutomationAgent | Spec + Code | Tests + `test-report.md` + CI config | ≥ 80% coverage |
| 4 | AnalysisAgent | `test-report.md` | Approval / Escalation | Spec compliance |

---

*End of Plan*
