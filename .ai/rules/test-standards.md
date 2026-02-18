# Test Standards

## Layers

| Layer | Pattern | Location | SUT Boundary |
|-------|---------|----------|--------------|
| Unit | `*.spec.ts` | Colocated with source | Single export (function/class) |
| Integration | `*.test.ts` | `test/` | Cross-module combination |

```
Rule: TST-LAYER
Violation: File extension or location does not match the table above
Enforcement: block
```

## Test Doubles

### Taxonomy

All test doubles MUST use `bun:test` APIs.
Hand-rolled counter variables or manual tracking objects are **prohibited** as substitutes for spy/mock.

| Type | Purpose | When to use | bun:test API |
|------|---------|-------------|--------------|
| Dummy | Fill parameter slots; never called | Unused required arguments | `{} as Type` or `undefined as any` |
| Stub | Return fixed values; no call tracking | Control return values of external deps | `mock(() => value)` |
| Spy | Record calls + preserve real behavior | Verify side-effect calls (count, args, order) | `spyOn(obj, 'method')` |
| Mock | Record calls + replace behavior | Replace external dependency entirely | `mock(() => fake)` with `.toHaveBeenCalled*` |
| Fixture | Reusable test data / state setup | Shared input across multiple `it` blocks | Factory function (no API needed) |

```
Rule: TST-DOUBLE-TYPE
Violation: Side-effect verification uses hand-rolled counter/flag instead of spyOn()/mock(),
           or a test double is used without fitting one of the types above
Enforcement: block
```

### Monkey-Patch Prohibition

Direct property assignment (`=`) on global/singleton objects to replace behavior is **prohibited**.
Always use `spyOn(obj, 'method').mockImplementation(...)` instead.

Examples of prohibited patterns:
- `(process as any).kill = fakeKill`
- `(globalThis as any).fetch = fakeFetch`
- `console.log = () => {}`

Restore via `try/finally` is NOT a substitute for `afterEach` + `mockRestore()`.

```
Rule: TST-MONKEY-PATCH
Violation: Global/singleton object property replaced via direct assignment (=) instead of spyOn().
           try/finally restore pattern used instead of afterEach + mockRestore().
Enforcement: block
```

### Mock Strategy Priority

When a SUT dependency needs to be replaced with a test double, apply in order:

1. **DI injection** — SUT accepts dependency via constructor/parameter → inject test double directly.
2. **`mock.module()`** — SUT imports dependency at module level (no DI) → intercept the import.
3. **DI refactoring proposal** — neither (1) nor (2) feasible → propose adding DI to SUT (write-gate approval required).

Choosing real execution because "mocking is difficult" is **prohibited**.

```
Rule: TST-MOCK-STRATEGY
Violation: Real dependency execution justified by "no DI available" or "mocking is complex"
           without attempting mock.module() or proposing DI refactoring
Enforcement: block
```

## Isolation

### Unit Test Isolation (`*.spec.ts`)

SUT = single export (function / class).

| Aspect | Rule |
|--------|------|
| External dependencies | **ALL** replaced with test doubles — no exceptions |
| DTO / Value Objects | May use real implementations (pure data, no side-effects) |
| I/O (filesystem, network, timer, random) | **Absolutely prohibited** in real form. Must be test-doubled. Temporary directories with cleanup = still a violation. |
| Side-effect calls | Verified via `spyOn()` or `mock()` — call count, arguments, call order |
| Module-level imports | Use `mock.module()` when DI is not available |

### Integration Test Isolation (`*.test.ts`)

SUT = cross-module combination.

| Aspect | Rule |
|--------|------|
| Inside SUT boundary | **Real implementations** — including real I/O between modules |
| Outside SUT boundary | **ALL** replaced with test doubles |
| External services (API, DB, third-party) | Always test-doubled, even if "inside" the project directory |
| Side-effect calls on outside deps | Verified via `spyOn()` or `mock()` |

```
Rule: TST-ISOLATION
Violation: [Unit] External dependency runs without test double,
           or real I/O executes (including temp dir with cleanup).
           [Integration] Dependency outside SUT boundary runs without test double,
           or dependency inside SUT boundary is unnecessarily mocked.
Enforcement: block
```

```
Rule: TST-HERMETIC
Violation: [Unit] Any non-deterministic resource (I/O, time, random) runs in real form.
           Temporary directories and cleanup do NOT satisfy this rule.
           [Integration] Non-deterministic resource OUTSIDE SUT boundary runs in real form.
Enforcement: block
```

```
Rule: TST-SIDE-EFFECT-SPY
Violation: SUT calls a side-effect (write/delete/send) on an outside dependency
           without spy verification via bun:test spyOn() or mock().
           Hand-rolled counter variables are NOT valid spy verification.
Enforcement: block
```

## Access Boundary

- **Unit**: White-box access to SUT internals allowed.
- **Integration**: Public (exported) API only.

If test access to private members is needed, export them via a `__testing__` object in the source file.
Bypass access to unexported members (type assertion, dynamic property, etc.) is prohibited.

```
Rule: TST-ACCESS
Violation: Integration test accesses unexported member without __testing__ export
Enforcement: block
```

## Test Case Design

### Exhaustive Scenario Enumeration

Before proposing, planning, or writing any test — including enhancement of existing tests —
the agent MUST enumerate test scenarios exhaustively.
This is a **hard gate** — skipping this step prohibits all subsequent test authoring.

#### TST-OVERFLOW — Scenario Flood

For every module/function under test, use `sequential-thinking` MCP to enumerate
scenarios across all 8 categories below.

| # | Category | Description |
|---|----------|-------------|
| 1 | Happy Path | Valid inputs producing expected outputs; primary use cases |
| 2 | Negative / Error | Invalid inputs, error paths, expected exceptions |
| 3 | Edge | Single boundary condition: empty, zero, one, max, min |
| 4 | Corner | Two or more boundary conditions occurring simultaneously |
| 5 | State Transition | Lifecycle changes, reuse after close/dispose, re-initialization |
| 6 | Concurrency / Race | Simultaneous access, ordering races, timing sensitivity |
| 7 | Idempotency | Repeated identical operations must yield identical results |
| 8 | Ordering | Input/execution order affecting outcomes |

##### Minimum scenario count — branch-count scaling

Count all branches in the SUT (if, else, switch/case, early return, throw, catch,
ternary `? :`, optional chaining `?.`, nullish coalescing `??`), then apply:

| SUT branch count | Minimum scenarios per applicable category |
|:-:|:-:|
| 0 – 2 | 10 |
| 3 – 5 | 25 |
| 6 + | 50 |

**Hard constraints — no exceptions:**

- Each applicable category MUST meet the minimum from the table above. Fewer is a rule violation.
- If a category does not apply to the target, declare `N/A: [concrete reason]`.
  The exclusion declaration itself is evidence of deliberation. Unjustified `N/A` is a violation.
- All enumeration MUST be performed via `sequential-thinking` MCP. Inline reasoning is prohibited.

**Required output — gate block:**

The checkpoint MUST include a **Sample (3+)** column per category.
Without concrete sample scenarios, the checkpoint is invalid.

**SUT source reference requirement:**
Each sample scenario MUST reference the specific SUT code it exercises —
file path + line number (e.g., `ownership.ts#L23`) or the exact condition expression
(e.g., `if (!owner)`). A sample without a SUT source reference is invalid.
This ensures OVERFLOW cannot be satisfied without actually reading the SUT code.

```
[OVERFLOW Checkpoint]
- Target: (module/function name)
- Branch count: (number)
- Minimum per category: (10 / 25 / 50)
- Categories:
  | Cat | Count | Sample (3+) |
  |-----|-------|-------------|
  | HP  | …     | 1.… 2.… 3.… |
  | NE  | …     | 1.… 2.… 3.… |
  | ED  | …     | 1.… 2.… 3.… |
  | CO  | …     | 1.… 2.… 3.… |
  | ST  | …     | 1.… 2.… 3.… or N/A: [reason] |
  | CR  | …     | 1.… 2.… 3.… or N/A: [reason] |
  | ID  | …     | 1.… 2.… 3.… or N/A: [reason] |
  | OR  | …     | 1.… 2.… 3.… or N/A: [reason] |
- Total scenarios: (number)
```

> ⚠️ **EXAMPLE ONLY** — The scenarios below are fictional. Do NOT copy them into real tests.
>
> ```
> [OVERFLOW Checkpoint]
> - Target: checkoutBook
> - Branch count: 4
> - Minimum per category: 25
> - Categories:
>   | Cat | Count | Sample (3+) |
>   |-----|-------|-------------|
>   | HP  | 27    | 1.member borrows available book (`checkout.ts#L15 if(available)`), 2.member borrows last copy (`checkout.ts#L22 copies===1`), 3.staff borrows reference book (`checkout.ts#L30 role==='staff'`) |
>   | NE  | 25    | 1.expired membership→reject (`checkout.ts#L8 if(expired)`), 2.book already checked out→error (`checkout.ts#L18 if(!available)`), 3.negative ISBN→throw (`checkout.ts#L5 if(isbn<0)`) |
>   | ED  | 26    | 1.ISBN empty string, 2.borrow limit=0, 3.due date=today |
>   | CO  | 25    | 1.expired member+last copy, 2.limit=0+overdue fine, 3.empty ISBN+null member |
>   | ST  | 25    | 1.checkout→return→re-checkout, 2.reserve→cancel→reserve, 3.suspend→reinstate→borrow |
>   | CR  | N/A: checkoutBook is synchronous with no shared state |
>   | ID  | 25    | 1.double checkout same book→same result, 2.return twice→idempotent, 3.renew expired twice |
>   | OR  | N/A: single-book operation, input order irrelevant |
> - Total scenarios: 153
> ```

Without this block → PRUNE is **prohibited**.

```
Rule: TST-OVERFLOW
Violation: Test code authored without prior scenario enumeration via sequential-thinking,
           or any applicable category has fewer scenarios than the branch-count minimum,
           or a category is marked N/A without concrete justification,
           or [OVERFLOW Checkpoint] block is missing,
           or any category row lacks 3+ sample scenarios,
           or any sample scenario lacks a SUT source reference (file#line or condition expression)
Enforcement: block
```

#### TST-PRUNE — Deduplication & Filtering

After OVERFLOW, review all enumerated scenarios and remove:

1. **Duplicates** — scenarios exercising the same code path. Merge into one.
2. **Excessive** — scenarios with no practical verification value.

**Hard constraints:**

- Every removal MUST state its rationale (e.g., "#12 and #35 test the same branch; keeping #12").
- Produce a **numbered final test list** with category tags.
- The final list is the **sole basis** for test code authoring. No ad-hoc additions without re-running OVERFLOW.
- **Key removals**: at least 5 removal rationales MUST be listed (or all if fewer than 5 total removals).

**Required output — gate block:**

```
[PRUNE Checkpoint]
- Scenarios before: (number)
- Removed: (number)
- Key removals (5+): (numbered rationale list)
- Final test count: (number)
- Final test list:
  1. [HP] (scenario description)
  2. [NE] (scenario description)
  …
```

> ⚠️ **EXAMPLE ONLY** — The scenarios below are fictional. Do NOT copy them into real tests.
>
> ```
> [PRUNE Checkpoint]
> - Scenarios before: 153
> - Removed: 131
> - Key removals (5+):
>   1. HP-2 & HP-3 exercise same "available copy" branch; keeping HP-1
>   2. NE-5~NE-18 all test input validation via same guard clause; keeping NE-1,NE-2,NE-3
>   3. ED-4~ED-20 boundary on loan-period field — library policy, not SUT logic; removed
>   4. CO-3~CO-20 same two-boundary combo with different values; keeping CO-1,CO-2
>   5. ID-2,ID-3 identical to ID-1 with trivial value change; keeping ID-1
> - Final test count: 22
> - Final test list:
>   1. [HP] member borrows an available book successfully
>   2. [HP] staff borrows a reference-only book
>   3. [NE] expired membership is rejected
>   4. [NE] already checked-out book returns error
>   5. [NE] negative ISBN throws
>   …
>   22. [ID] double checkout yields identical result
> ```

Without this block → test code authoring is **prohibited**.

```
Rule: TST-PRUNE
Violation: Test code authored without a finalized PRUNE list,
           or scenarios removed without stated rationale,
           or test code contains cases not present in the PRUNE list,
           or [PRUNE Checkpoint] block is missing,
           or Key removals lists fewer than 5 rationales (when total removals ≥ 5)
Enforcement: block
```

#### TST-PRUNE-MATCH — Final List ↔ Code Consistency

After tests are written, the number of `it` blocks MUST match the PRUNE final test count.

```
Rule: TST-PRUNE-MATCH
Violation: PRUNE final list count and actual it block count differ,
           and no explicit rationale is provided for the discrepancy
Enforcement: block
```

### Branch Coverage (Unit / Integration only)

Every branch in the SUT MUST have a corresponding `it`.
Branches include: if, else, switch/case, early return, throw, catch, ternary (`? :`), optional chaining (`?.`), nullish coalescing (`??`).

```
Rule: TST-BRANCH
Applies to: Unit, Integration
Violation: A SUT branch (if/else/switch/early return/throw/catch/ternary/?./??)
           has no corresponding it
Enforcement: block
```

### Input Partitioning (Unit / Integration only)

For each SUT parameter, identify equivalence classes and test one representative value + boundary values per class.

Required cases by type:

| Parameter Type | Required it |
|---------------|-------------|
| nullable (`T \| null \| undefined`) | null input, undefined input |
| array (`T[]`) | empty array, single element, multiple elements |
| string | empty string |
| number | 0, negative (if applicable) |
| union / enum | at least 1 per variant |
| boolean | true, false |

**Class hierarchy consistency:**
When SUT is a class hierarchy (`extends`), if the base class test covers N equivalence classes
for a constructor parameter, each subclass MUST cover the same N classes — OR explicitly declare
why fewer is sufficient (e.g., "constructor is pass-through with no override").

```
Rule: TST-INPUT-PARTITION
Applies to: Unit, Integration
Violation: An equivalence class of a SUT parameter is untested,
           or a required case from the type table above is missing,
           or a subclass covers fewer equivalence classes than its base class
           without explicit justification
Enforcement: block
```

### No Duplicates

No two `it` blocks may verify the same branch + same equivalence class.
Different equivalence classes passing through the same branch are NOT duplicates.

Tests with identical setup and identical assertion logic that claim to test different scenarios
are duplicates — **the `it` title alone does not differentiate them.**
Each `it` MUST exercise a distinct code path or distinct input equivalence class.

```
Rule: TST-NO-DUPLICATE
Violation: Duplicate it blocks for the same branch and equivalence class,
           or tests with identical setup + assertion where only the it title differs
Enforcement: block
```

### Single Scenario

```
Rule: TST-SINGLE-SCENARIO
Violation: A single it verifies multiple scenarios or branches
Enforcement: block
```

## Test Structure

```
Rule: TST-BDD
Violation: it title is not in BDD format (should ... when ...)
Enforcement: block
```

```
Rule: TST-AAA
Violation: it body does not follow Arrange → Act → Assert structure
Enforcement: block
```

```
Rule: TST-DESCRIBE-UNIT
Violation: Unit test describe 1-depth is not the SUT identifier,
           or describe title starts with "when "
Enforcement: block
```

## Test Hygiene

```
Rule: TST-CLEANUP
Violation: Test-created resources not cleaned up in teardown
Enforcement: block
```

```
Rule: TST-STATE
Violation: Shared mutable state exists between tests
Enforcement: block
```

```
Rule: TST-RUNNER
Violation: Test runner other than bun:test is used
Enforcement: block
```

```
Rule: TST-COVERAGE-MAP
Violation: A directory has ≥ 1 *.spec.ts but contains *.ts files
           without a corresponding spec
           (excludes *.d.ts, *.spec.ts, *.test.ts, index.ts, types.ts)
Enforcement: block
```
