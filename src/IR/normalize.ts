import { IRNode } from '../types'
// ---- Flatten nested assignments in your IR ----

/**
 * Flatten pass entry point.
 * @param ir Nested SSA IR
 * @returns Flattened IR sequence
 */
export function flattenAssignments(ir: IRNode[]): IRNode[] { return flattenBlock(ir); }

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

    out.push(...initFlat, ...hoistedCond, {
      ...stmt,
      init: undefined,             // we already emitted it
      condition: cond,
      body: body,
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