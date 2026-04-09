import { ASTNode, IRNode } from "../types";

/**
 * Convert a list of AST nodes into preliminary SSA IR nodes (still nested).
 */
export function generateSSA(body: ASTNode[]): IRNode[] {
  const ssa: IRNode[] = [];
  for (const node of body) {
    ssa.push(visitNode(node));
  }
  return ssa;
}

/**
 * Map: variable base name -> next version integer to allocate (SSA versioning).
 */
let nextVersionNumber = new Map<string, number>();
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

function resetSSAState() {
  nextVersionNumber = new Map<string, number>();
  currentVersionForReading = new Map<string, string>();
}

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
      resetSSAState();
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

      const ifCondition = visitNode(node.condition);

      currentVersionForReading = new Map(beforeBranches);
      const ifBody = generateSSA(node.body);
      const afterIf = new Map(currentVersionForReading);

      const elseIfBodies = [];
      const branchMaps: Map<string, string>[] = [afterIf];

      for(const elseif of node.elseIf || []) {
        const elseIfCondition = visitNode(elseif.condition);
        currentVersionForReading = new Map(beforeBranches);
        const elseIfBody = generateSSA(elseif.body);
        const afterElseIf = new Map(currentVersionForReading);
        branchMaps.push(afterElseIf);
        elseIfBodies.push({
          condition: elseIfCondition,
          body: elseIfBody
        });
      }

      let elseBody: IRNode[] = [];
      if(node.else) {
        currentVersionForReading = new Map(beforeBranches);
        elseBody = generateSSA(node.else);
        branchMaps.push(new Map(currentVersionForReading));
      }

      //const totalBranches = 1 + (node.elseIf?.length || 0) + (node.else ? 1 : 0);
      const phiFunctions = createPhiFunctions(branchMaps, beforeBranches);

      return {
        label: "if",
        condition: ifCondition,
        body: ifBody,
        elseIf: elseIfBodies,
        else: elseBody,
        phi: phiFunctions.length == 0 ? null : phiFunctions
      }
    case "WhileLoop":
      // Snapshot before loop
      const beforeLoop = new Map(currentVersionForReading);

      // Create provisional (non-version-consuming) header phis
      let provisionalWhilePhis = createProvisionalLoopHeaderPhis(beforeLoop);

      // Publish provisional names so condition/body read them
      for (const p of provisionalWhilePhis) currentVersionForReading.set(p.originalVar, p.name);

      // Condition reads provisional phi names
      let whileCondition: any = visitNode(node.condition);

      // Body
      const whileBody = generateSSA(node.body);
      const afterBody = new Map(currentVersionForReading);

      // Fill backedge source
      for (const p of provisionalWhilePhis) {
        const updated = afterBody.get(p.originalVar);
        if (updated) p.sources[1] = updated;
      }

      // Determine usage (condition + body)
      const usedWhile = collectUsedBaseNamesFromIR([whileCondition, whileBody]);

      // Finalize
      const finalizedWhile = finalizeLoopHeaderPhis(
        provisionalWhilePhis,
        usedWhile,
        [whileCondition, whileBody]
      );

      // If condition was a primitive string, apply replacement explicitly
      if (typeof whileCondition === 'string' && finalizedWhile.replacements.has(whileCondition)) whileCondition = finalizedWhile.replacements.get(whileCondition)!;

      return {
        label: "while",
        phi: finalizedWhile.headerPhis.length ? finalizedWhile.headerPhis : null,
        condition: whileCondition,
        body: whileBody,
        phiExit: finalizedWhile.exitPhis.length ? finalizedWhile.exitPhis : null
      }

    case "ForLoop":
      // Initialization outside loop
      const init = visitNode(node.initialization);

      const beforeFor = new Map(currentVersionForReading);

      // Provisional header phis
      let provisionalForPhis = createProvisionalLoopHeaderPhis(beforeFor);
      for (const p of provisionalForPhis) currentVersionForReading.set(p.originalVar, p.name);

      // Condition
      let forCondition: any = visitNode(node.condition);

      // Body
      const forBody = generateSSA(node.body);

      // Update (i++, etc.)
      const update = visitNode(node.update);
      const afterUpdate = new Map(currentVersionForReading);

      // Backedge fill
      for (const p of provisionalForPhis) {
        const upd = afterUpdate.get(p.originalVar);
        if (upd) p.sources[1] = upd;
      }

      const usedFor = collectUsedBaseNamesFromIR([forCondition, forBody, update]);

      const finalizedFor = finalizeLoopHeaderPhis(
        provisionalForPhis,
        usedFor,
        [forCondition, forBody, update]
      );

      if (typeof forCondition === 'string' && finalizedFor.replacements.has(forCondition)) forCondition = finalizedFor.replacements.get(forCondition)!;

      return {
        label: "for",
        init,
        phi: finalizedFor.headerPhis.length ? finalizedFor.headerPhis : null,
        condition: forCondition,
        body: forBody,
        update,
        phiExit: finalizedFor.exitPhis.length ? finalizedFor.exitPhis : null
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
 * Construct phi nodes for variables whose versions differ among branches.
 * @param branchMaps Array of version maps, one per branch (then, else, loop body, etc.)
 * @param before Snapshot prior to branching
 * @returns Array of phi IR nodes
 */
function createPhiFunctions(branchMaps: Map<string, string>[], before: Map<string, string>, forcePhi: boolean = false): IRNode[] {
  const phiFunctions: IRNode[] = [];
  const allNames = new Set<string>();

  // Collect all variables
  for(const map of branchMaps) {
    for(const name of map.keys()) allNames.add(name);
  }
  for(const name of before.keys()) {
    allNames.add(name);
  }

  for(const varName of allNames) {
    // Build incoming list per branch
    const incoming = branchMaps.map(
      b => b.get(varName) ?? before.get(varName) ?? `${varName}0`
    );

    const unique = [...new Set(incoming)];

    if(unique.length <= 1 && !forcePhi) continue;

    const phiName = createTemporaryVariable(varName);
    phiFunctions.push({
      name: phiName,
      op: "phi",
      sources: incoming.slice(), // copy
      originalVar: varName
    });
  }

  return phiFunctions;
}

/**
 * Collect base variable names (strip trailing digits) used inside IR fragments.
 * Strings like "x3" -> "x". Literals (pure digits) ignored.
 */
function collectUsedBaseNamesFromIR(ir: any): Set<string> {
  const used = new Set<string>();

  function base(name: string): string | null {
    if (typeof name !== 'string') return null;
    if (/^\d+$/.test(name)) return null; // numeric literal
    const m = name.match(/^([A-Za-z_]\w*)(\d+)$/);
    if (m) return m[1];
    // Also allow raw identifiers without digits (e.g., in interim forms)
    if (/^[A-Za-z_]\w*$/.test(name)) return name;
    return null;
  }

  function visit(node: any) {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'string') {
      const b = base(node);
      if (b) used.add(b);
      return;
    }
    if (typeof node !== 'object') return;

    // Node fields
    for (const key of Object.keys(node)) {
      if (key === 'op' && node.op === 'phi') {
        // sources processed below normally
      }
      visit(node[key]);
    }
  }

  visit(ir);
  return used;
}

/**
 * Create provisional loop header phis without consuming SSA version numbers.
 * Names are temporary and will be replaced if the phi survives.
 */
function createProvisionalLoopHeaderPhis(before: Map<string,string>): IRNode[] {
  const phis: IRNode[] = [];
  // Consider every currently known variable as candidate
  for (const varName of before.keys()) {
    phis.push({
      name: `__phi_tmp_${varName}_${before.get(varName)}`, // provisional
      op: "phi",
      sources: [before.get(varName)!, undefined], // second filled later
      originalVar: varName
    } as any);
  }
  return phis;
}

/**
 * Finalize provisional header phis:
 * - Determine which are real loop-carried vars (changed + used).
 * - Assign real SSA names to survivors (consuming version numbers).
 * - Rewrite IR fragments to replace provisional names.
 * - Create exit phis for survivors (headerPhi, backedgeVersion) if changed.
 */
function finalizeLoopHeaderPhis(provisional: IRNode[], used: Set<string>,fragmentsToRewrite: any[]): { headerPhis: IRNode[], exitPhis: IRNode[], replacements: Map<string,string> } {
  const survivors: IRNode[] = [];
  const replacements = new Map<string,string>(); // provisional -> final/preheader
  const exitPhis: IRNode[] = [];

  for (const p of provisional) {
    const pre = p.sources[0];
    const back = p.sources[1];
    const changed = !!back && back !== pre && back !== p.name;
    const isUsed = used.has(p.originalVar);
    if (changed && isUsed) {
      const realName = createTemporaryVariable(p.originalVar);
      replacements.set(p.name, realName);
      p.name = realName;
      survivors.push(p);
    } else {
      replacements.set(p.name, pre);
      currentVersionForReading.set(p.originalVar, pre);
    }
  }

  if (replacements.size) rewriteNamesInIR(fragmentsToRewrite, replacements);

  for (const h of survivors) {
    const pre = h.sources[0];
    const back = h.sources[1];
    if (!back) continue;
    if (back === pre) continue;
    if (back === h.name) continue;
    const exitName = createTemporaryVariable(h.originalVar);
    exitPhis.push({
      name: exitName,
      op: "phi",
      sources: [h.name, back],
      originalVar: h.originalVar
    } as any);
    currentVersionForReading.set(h.originalVar, exitName);
  }

  return { headerPhis: survivors, exitPhis, replacements };
}

// Rewrites all string leaves matching provisional phi names to their replacement.
// Handles nested objects and arrays in-place.
function rewriteNamesInIR(fragments: any[], replacements: Map<string,string>) {
  function transform(node: any): any {
    if (node == null) return node;
    if (typeof node === 'string') {
      return replacements.get(node) ?? node;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = transform(node[i]);
      }
      return node;
    }
    if (typeof node === 'object') {
      for (const key of Object.keys(node)) {
        node[key] = transform(node[key]);
      }
      return node;
    }
    return node;
  }
  for (let i = 0; i < fragments.length; i++) {
    fragments[i] = transform(fragments[i]);
  }
}