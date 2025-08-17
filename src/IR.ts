import {AST, ASTNode} from './parser';

/**
 * Intermediate Representation (IR) & SSA construction
 * --------------------------------------------------
 * This module converts the high‑level AST into a lightweight SSA‑like IR.
 * The IR is still fairly structural (nested control flow objects), then a
 * secondary pass (flattenAssignments) normalizes nested assignment /
 * expression forms so later optimization or codegen passes can work on a
 * simpler, mostly flat sequence of operations.
 */

/**
 * IRNode (Intermediate Representation node).
 * A deliberately flexible shape used during early SSA + normalization phases.
 *
 * Common fields (present depending on node kind):
 *  - op:      Primitive operation or marker ("=", "call", "phi", arithmetic operator, "ret").
 *  - label:   Structural / control-flow marker ("func", "if", "while", "for").
 *  - name:    SSA target variable for assignments / phi results / temp call result.
 *  - value:   RHS of assignments, return expressions, or nested expression object.
 *  - params:  Array of parameter SSA names for a function declaration (label === "func").
 *  - body:    Array<IRNode> representing the main block for structural nodes.
 *  - elseIf:  Array<{condition: IRNode, body: IRNode[]}> for if-chains.
 *  - else:    IRNode[] body of the else branch (if present).
 *  - phi:     Array<IRNode> of phi nodes at a join point / loop header.
 *  - phiExit: Array<IRNode> of exit phi nodes for loops (current design; may be deferred).
 *  - sources: Array<string> SSA sources for a phi node (when op === "phi").
 *  - condition: IRNode or primitive representing loop / branch condition.
 *  - init / update: For "for" loops, the initialization and update pieces.
 *
 * Because this IR still evolves, we retain an index signature for flexibility.
 */
interface IRNode {
  op?: string;
  [key: string]: any;
}

/**
 * Map: variable base name -> next version integer to allocate (SSA versioning).
 */
let nextVersionNumber = new Map<string, number>();

/**
 * Map: variable base name -> most recently defined SSA name (e.g., x -> x3).
 * Reads consult this map to know which version to reference.
 */
let currentVersionForReading = new Map<string, string>();

/**
 * Allocate a fresh SSA version for a variable and mark it as the current
 * readable definition.
 */
function createTemporaryVariable(variable: string): string {
  const versionNum = nextVersionNumber.get(variable) || 0;
  const newVar = `${variable}${versionNum}`;
  nextVersionNumber.set(variable, versionNum + 1); // bump counter for future definitions
  currentVersionForReading.set(variable, newVar);   // publish new readable version
  return newVar;
}

/**
 * Return the most recent SSA name (or implicit version 0 if not yet defined).
 */
function getCurrentReadableVersion(variable: string): string {
  return currentVersionForReading.get(variable) || `${variable}0`;
}

/**
 * Public entry: build SSA then run a normalization pass to flatten nested
 * assignment / expression trees. Further lowering could occur later.
 */
export function generateIR(ast: AST): IRNode[] {
  let ssa = generateSSA(ast.body);
  ssa = flattenAssignments(ssa);
  // Potential future step: generateLowerIR(ssa)
  return ssa;
}

/**
 * Convert a list of AST nodes into preliminary SSA IR nodes (still nested).
 */
function generateSSA(body: ASTNode[]): IRNode[] {
  const ssa: IRNode[] = [];
  for (const node of body) {
    ssa.push(visitNode(node));
  }
  return ssa;
}

/**
 * TODO / Future Refinements:
 * - Loop update should reference the latest loop-carried phi, not initial version.
 * - Delay creation of exit phi nodes until a consumer requires them.
 * - Ensure all branches assign variables that participate in a phi (else supply defaults).
 * - Restrict phi placement strictly to join points / loop headers.
 */

/**
 * Visit an AST node and return an IR representation.
 * Some AST nodes become a single assignment or expression; others (functions,
 * loops, conditionals) become structured objects with nested IR arrays.
 *
 * Key lowering decisions here:
 *  - Variable & assignment nodes allocate fresh SSA names.
 *  - ++ / -- are lowered later in the UnaryExpression case to explicit + / - with constant 1.
 *  - Branch handling collects per-branch SSA versions for later phi emission.
 */
function visitNode(node: ASTNode): any {
    switch(node.type) {
    case "FunctionDeclaration":
        return {
            label: "func",
            name: node.name,
            params: node.parameters.map((params: any) => createTemporaryVariable(params.name)),
            body: generateSSA(node.body)
        };
    case "FunctionCall":
        return {
            name: createTemporaryVariable("f"),
            op: "=",
            value: {
                op: "call",
                name: node.name,
                args: node.arguments.map((args: any) => visitNode(args))
            }
        }
    case "VariableDeclaration":
        const rightSideValue = visitNode(node.value);
        const newVar = createTemporaryVariable(node.name);
        return {
            name: newVar,
            op: "=",
            value: rightSideValue
        }
    case "AssignmentExpression":
        const _rightSideValue = visitNode(node.right);
        const _newVar = createTemporaryVariable(node.left.name);
        return {
            name: _newVar,
            op: "=",
            value: _rightSideValue
        }
    case "IfStatement":
      // Snapshot versions prior to branching; used to fill in missing branch definitions.
      const beforeBranches = new Map(currentVersionForReading);
      // Accumulates (variable -> versions array) where index matches branch order.
      const branchVersions: Map<string, string[]> = new Map();

      const ifBody = createBody(node.body, branchVersions, beforeBranches);
      const elseIfBodies = createElseIfBodies(node, branchVersions, beforeBranches);

      // Restore snapshot before processing else so changes in if/else-if don't leak.
      currentVersionForReading = new Map(beforeBranches);
      const elseBody = node.else ? createBody(node.else, branchVersions, beforeBranches) : [];

      const totalBranches = 1 + (node.elseIf?.length || 0) + (node.else ? 1 : 0);
      const phiFunctions = createPhiFunctions(branchVersions, beforeBranches, totalBranches);

      return {
        label: "if",
        condition: visitNode(node.condition),
        body: ifBody,
        elseIf: elseIfBodies,
        else: elseBody,
        phi: phiFunctions
      }
    case "WhileLoop":
      // Snapshot entering the loop; used both for header phi construction and exit phi fallback.
      const beforeLoop = new Map(currentVersionForReading);
      const loopVersions: Map<string, string[]> = new Map();
      const body = createBody(node.body, loopVersions, beforeLoop);
      // Header phi merges: incoming (pre-loop) vs. loop-carried (end of body) versions (2 sources total).
      const _phiFunctions = createPhiFunctions(loopVersions, beforeLoop, 2);
      const condition = visitNode(node.condition);
      // Snapshot after executing body, to derive potential exit phi nodes.
      const afterLoop = new Map(currentVersionForReading);
      const exitVersions: Map<string, string[]> = new Map();
      recordVersions(exitVersions, beforeLoop, afterLoop);
      const exitPhiFunctions = createPhiFunctions(exitVersions, beforeLoop, 2);
      return {
        label: "while",
        phi: _phiFunctions,
        condition: condition,
        body: body,
        phiExit: exitPhiFunctions
      }
    case "ForLoop":
      const init = visitNode(node.initialization); // Lower initialization immediately.
      const beforeForLoop = new Map(currentVersionForReading);
      const forLoopVersions: Map<string, string[]> = new Map();
      const forBody = createBody(node.body, forLoopVersions, beforeForLoop);
      const update = visitNode(node.update); // ++ / -- lowered in UnaryExpression path.
      // Record loop-carried versions (after update) for potential phi merge.
      recordVersions(forLoopVersions, beforeForLoop, currentVersionForReading);
      const forPhiFunctions = createPhiFunctions(forLoopVersions, beforeForLoop, 2);
      const _condition = visitNode(node.condition);
      const afterForLoop = new Map(currentVersionForReading);
      const _exitVersions: Map<string, string[]> = new Map();
      recordVersions(_exitVersions, beforeForLoop, afterForLoop);
      const _exitPhiFunctions = createPhiFunctions(_exitVersions, beforeForLoop, 2);
      return {
        label: "for",
        init: init,
        phi: forPhiFunctions,
        condition: _condition,
        body: forBody,
        update: update,
        exit: _exitPhiFunctions,
      }
        case "ControlFlowStatement":
            return node.flowType;
        case "ReturnStatement":
            return {
                op: "ret",
                value: visitNode(node.value)
            }
        case "BinaryExpression":
            return {
                left: visitNode(node.left),
                op: node.operator,
                right: visitNode(node.right),
            }
    case "UnaryExpression":
      // ++ / -- lowered into explicit arithmetic assignment: x(k+1) = x(k) (+|-) 1
      if (node.operator == "++" || node.operator == "--") {
        const varName = node.argument.name;
        const rightVar = getCurrentReadableVersion(varName);
        const leftVar = createTemporaryVariable(varName);
        const operator = node.operator == "++" ? "+" : "-";
        return {
          name: leftVar,
          op: "=",
          value: {
            left: rightVar,
            op: operator,
            right: '1'
          }
        }
      }
      return {
        value: visitNode(node.argument),
        op: node.operator
      }
        case "ExpressionStatement":
            return visitNode(node.expression);
        case "Identifier":
            return getCurrentReadableVersion(node.name);
        case "Literal":
            return node.name;
        default:
            throw new Error(`Unknown AST node type: ${node.type}`);
    }
}

/**
 * Record variable versions that changed between two snapshots.
 * Only pushes a version if its SSA name differs from the prior snapshot.
 *
 * @param versions Accumulator: variable -> list of produced versions
 * @param before   Snapshot of versions before executing a region
 * @param after    Snapshot after executing the region
 */
function recordVersions(versions: Map<string, string[]>, before: Map<string, string>, after: Map<string, string>) {
    for(const [varName, afterVersion] of after) {
        const version = before.get(varName);
        if(version !== afterVersion) {
            if(!versions.has(varName)) {
                versions.set(varName, []);
            }
            versions.get(varName)!.push(afterVersion);
        }
    }    
}

/**
 * Generate IR for a block while tracking version changes for potential phi nodes.
 *
 * @param body            AST nodes inside the block
 * @param branchVersions  Accumulates version arrays per variable
 * @param before          Snapshot prior to block execution
 * @returns Block IR (nested form)
 */
function createBody(body: ASTNode[], branchVersions: Map<string, string[]>, before: Map<string, string>): IRNode[] {
    const _body = generateSSA(body);
    const after = new Map(currentVersionForReading);
    recordVersions(branchVersions, before, after);
    return _body;
}

/**
 * Build IR bodies for each else-if clause, restoring the starting snapshot
 * before each clause to isolate their individual version evolutions.
 *
 * @param node           IfStatement node containing elseIf array
 * @param branchVersions Accumulator of per-branch produced versions
 * @param before         Snapshot before entering the if ladder
 * @returns Array of branch objects with condition + body
 */
function createElseIfBodies(node: ASTNode, branchVersions: Map<string, string[]>, before: Map<string, string>) {
    const elseIfBodies = [];
    for(const elseif of node.elseIf || []) {
        currentVersionForReading = new Map(before);

        const elseIfBody = generateSSA(elseif.body);
        const afterElseIfBranch = new Map(currentVersionForReading);
        recordVersions(branchVersions, before, afterElseIfBranch);

        elseIfBodies.push({
            condition:  visitNode(elseif.condition),
            body: elseIfBody
        });
    }
    return elseIfBodies;
}

/**
 * Construct phi nodes for variables whose versions differ among branches.
 * Missing branch entries default to the pre-branch version (no write on that path).
 *
 * @param branchVersions Map var -> versions per branch
 * @param beforeBranches Snapshot prior to branching
 * @param totalBranches  Number of branch paths (if + else-if(s) + optional else)
 * @returns Array of phi IR nodes
 */
function createPhiFunctions(branchVersions: Map<string, string[]>, beforeBranches: Map<string, string>, totalBranches: number): IRNode[] {
    const phiFunctions: IRNode[] = [];

    for(const [varName, versions] of branchVersions) {
        // Build a complete list of versions, substituting the pre-branch version
        // where a branch did not produce a new one.
        const completeVersions: string[] = [];
        for (let i = 0; i < totalBranches; i++) {
          completeVersions[i] = versions[i] || beforeBranches.get(varName) || `${varName}0`;
        }
        // Skip phi if all sources identical (no merging necessary).
        const uniqueVersions = [...new Set(completeVersions)];
        if (uniqueVersions.length <= 1) continue;
        const phiVar = createTemporaryVariable(varName); // new SSA name for merged value.
        phiFunctions.push({ name: phiVar, op: "phi", sources: completeVersions });
    }
    return phiFunctions;
}

// ---- Flatten nested assignments in your IR ----

/**
 * Flatten pass entry point.
 * @param ir Nested SSA IR
 * @returns Flattened IR sequence
 */
function flattenAssignments(ir: IRNode[]): IRNode[] { return flattenBlock(ir); }

/**
 * Flatten each statement of a block and accumulate results.
 */
function flattenBlock(block: IRNode[]): IRNode[] {
  const out: IRNode[] = [];
  for (const stmt of block) flattenStmt(stmt, out);
  return out;
}

/**
 * Flatten a single statement, hoisting nested expressions as needed.
 * @param stmt Original statement
 * @param out  Accumulator for flattened output
 */
function flattenStmt(stmt: IRNode, out: IRNode[]) {
  if(stmt?.label === "func") {
    out.push({
      ...stmt,
      body: flattenBlock(stmt.body ?? []),
    });
    return;
  }

  if (stmt?.label === "if") {
    const hoistedCond: IRNode[] = [];
    const cond = flattenExpr(stmt.condition, hoistedCond);
    const body = flattenBlock(stmt.body ?? []);
    const elseIf = (stmt.elseIf ?? []).map((br: IRNode) => {
      const hc: IRNode[] = [];
      const c = flattenExpr(br.condition, hc);
      // else-if condition hoisted must appear before that branch; place them just before branch.
      return { condition: c, body: [...hc, ...flattenBlock(br.body ?? [])] };
    });
    const elseBody = flattenBlock(stmt.else ?? []);

    out.push(...hoistedCond, {
      ...stmt,
      condition: cond,
      body,
      elseIf,
      else: elseBody,
      // phi unchanged
    });
    return;
  }

  if (stmt?.label === "while") {
    const hoistedCond: IRNode[] = [];
    const cond = flattenExpr(stmt.condition, hoistedCond);
    const body = flattenBlock(stmt.body ?? []);
    out.push(...hoistedCond, {
      ...stmt,
      condition: cond,
      body,
    });
    return;
  }

  if (stmt?.label === "for") {
    // init is a statement-shaped thing in your IR; flatten it as statements
    const initFlat: IRNode[] = [];
    flattenStmt(stmt.init, initFlat);

    const hoistedCond: IRNode[] = [];
    const cond = flattenExpr(stmt.condition, hoistedCond);

    // update may contain nested assigns; hoist them and append at loop tail
    const updateHoisted: IRNode[] = [];
    const updateStmt = flattenUpdate(stmt.update, updateHoisted);

    const body = flattenBlock(stmt.body ?? []);
    const bodyWithUpdate = [...body, ...updateHoisted, updateStmt].filter(Boolean);

    out.push(...initFlat, ...hoistedCond, {
      ...stmt,
      init: undefined,             // we already emitted it
      condition: cond,
      body: bodyWithUpdate,
      update: updateStmt,          // keep a simple, flat version for reference
    });
    return;
  }

  // Plain assignment: { name, op: "=", value }
  if (stmt?.op === "=" && "name" in stmt) {
    const hoisted: IRNode[] = [];
    const rhs = flattenExpr(stmt.value, hoisted);
    out.push(...hoisted, { ...stmt, value: rhs });
    return;
  }

  // Return: { op: "ret", value: ... }
  if (stmt?.op === "ret") {
    const hoisted: IRNode[] = [];
    const v = flattenExpr(stmt.value, hoisted);
    out.push(...hoisted, { ...stmt, value: v });
    return;
  }

  // Expression statement (already normalized to an expression node)
  if (stmt?.op && !("name" in stmt) && !stmt.label) {
    const hoisted: IRNode[] = [];
    const expr = flattenExpr(stmt, hoisted);
    // If expr reduces to a pure name/const, we can drop it; else keep it.
    if (hoisted.length) out.push(...hoisted);
    if (isMaterializedExpr(expr)) out.push(expr);
    return;
  }

  // Control flow tokens like "break"/"continue", or phis, or already-flat simple nodes:
  out.push(stmt);
}

/* ---------- Expressions ---------- */

/**
 * Flatten an expression, emitting any nested assignments / side effects
 * into the hoisted list, returning a pure expression / identifier / literal.
 * @param expr Expression node or primitive
 * @param hoisted Accumulator of generated IR statements
 */
function flattenExpr(expr: any, hoisted: IRNode[]): any {
  // Primitives / names
  if (expr == null || typeof expr !== "object") return expr;
  if (typeof expr === "string") return expr;

  // Nested assignment detected: { name, op: "=", value: ... }
  if (expr.op === "=" && "name" in expr) {
    const inner: IRNode[] = [];
    const v = flattenExpr(expr.value, inner);
    hoisted.push(...inner, { ...expr, value: v });
    return expr.name; // replace nested assignment with its name
  }

  // Call: { op: "call", name, args: [...] }
  if (expr.op === "call") {
    const args: any[] = [];
    for (const a of expr.args ?? []) {
      const inner: IRNode[] = [];
      const av = flattenExpr(a, inner);
      hoisted.push(...inner);
      args.push(av);
    }
    return { ...expr, args };
  }

  // Binary: { left, op: "+|...|cmp", right }
  if ("left" in expr && "right" in expr && "op" in expr) {
    const lH: IRNode[] = [], rH: IRNode[] = [];
    const L = flattenExpr(expr.left, lH);
    const R = flattenExpr(expr.right, rH);
    hoisted.push(...lH, ...rH);
    return { ...expr, left: L, right: R };
  }

  // Unary: { value, op: "neg"|"!"|... }
  if ("value" in expr && "op" in expr) {
    const inner: IRNode[] = [];
    const V = flattenExpr(expr.value, inner);
    hoisted.push(...inner);
    return { ...expr, value: V };
  }

  // Anything else (phi nodes, plain identifiers already as strings, etc.)
  return expr;
}

/* ---------- Helpers ---------- */

/**
 * Normalize a loop update clause, hoisting inner assignments.
 * @param update  Update node (assignment or expression)
 * @param hoisted Accumulator for hoisted statements
 */
function flattenUpdate(update: any, hoisted: IRNode[]): any {
  if (!update) return update;
  if (update.op === "=" && "name" in update) {
    const inner: IRNode[] = [];
    const v = flattenExpr(update.value, inner);
    hoisted.push(...inner);
    return { ...update, value: v };
  }
  // If update is modeled as an expression node (rare in your IR), normalize it:
  const inner: IRNode[] = [];
  const v = flattenExpr(update, inner);
  hoisted.push(...inner);
  return v;
}

/**
 * Determine if an expression requires materialization as a statement.
 * Pure identifiers / literals that stand alone are dropped.
 */
function isMaterializedExpr(expr: any): boolean {
  if (expr == null) return false;
  if (typeof expr !== "object") return false; // pure const/name => no statement needed
  if (expr.op === "=" && "name" in expr) return true;
  if (expr.op === "call") return true;
  if ("left" in expr && "right" in expr && "op" in expr) return true;
  if ("value" in expr && "op" in expr) return true;
  return false;
}


/*function generateLowerIR(ssa: IRNode[]): IRNode[] {
    const lowerIR: IRNode[] = [];
    return lowerIR;
}*/
