import { AST, ASTNode } from './parser';

/**
 * Semantic Analysis Module
 * 
 * This module performs semantic analysis on the Abstract Syntax Tree (AST) to:
 * - Check type compatibility and type safety
 * - Resolve variable and function references
 * - Validate function calls and their arguments
 * - Ensure proper scoping rules
 * - Handle deferred resolution of function calls through a call stack
 * - Validate control flow statements (break/continue) in proper contexts
 */

// Type definitions for symbol table entries

/**
 * Information stored for each variable in the symbol table
 */
type VariableInfo = {
    type: string;           // Data type of the variable (int, string, boolean, etc.)
};

/**
 * Information stored for each function in the symbol table
 */
type FunctionInfo = {
    params: {name: string, type: string}[];     // Function parameters with names and types
    returnType: string;                         // Return type of the function
};

/**
 * Represents a lexical scope with symbol tables for variables and functions
 * Implements hierarchical scoping with parent-child relationships
 */
interface Scope {
    parent: Scope | null;                      // Parent scope (null for global scope)
    name: string;                              // Name of the scope (e.g., "global", "function_name")
    variables: Map<string, VariableInfo>;      // Symbol table for variables
    functions: Map<string, FunctionInfo>;      // Symbol table for functions
}

// Scope management functions

/**
 * Declares a new variable in the given scope
 * @param scope The scope to declare the variable in
 * @param name Variable name
 * @param type Variable data type
 * @throws Error if variable is already declared in this scope
 */
function declareVariable(scope: Scope, name: string, type: string): void {
    if (scope.variables.has(name)) throw new Error(`Variable '${name}' already declared in this scope.`);
    scope.variables.set(name, { type });
}

/**
 * Resolves a variable by searching up the scope chain
 * @param scope Starting scope for the search
 * @param name Variable name to resolve
 * @returns Variable information if found
 * @throws Error if variable is not defined in any accessible scope
 */
function resolveVariable(scope: Scope, name: string): VariableInfo {
    if (scope.variables.has(name)) return scope.variables.get(name)!;
    if (scope.parent) return resolveVariable(scope.parent, name);
    throw new Error(`Variable '${name}' is not defined.`);
}

/**
 * Declares a new function in the given scope
 * @param scope The scope to declare the function in
 * @param name Function name
 * @param info Function signature information
 * @throws Error if function is already declared in this scope
 */
function declareFunction(scope: Scope, name: string, info: FunctionInfo): void {
    if (scope.functions.has(name)) throw new Error(`Function '${name}' already declared in this scope.`);
    scope.functions.set(name, info);
}

/**
 * Resolves a function by searching up the scope chain
 * @param scope Starting scope for the search
 * @param name Function name to resolve
 * @returns Function information if found
 * @throws Error if function is not defined in any accessible scope
 */
function resolveFunction(scope: Scope, name: string): FunctionInfo {
    if (scope.functions.has(name)) return scope.functions.get(name)!;
    if (scope.parent) return resolveFunction(scope.parent, name);
    throw new Error(`Function '${name}' is not defined.`);
}

/**
 * Creates a new scope with the specified parent and name
 * @param parent Parent scope (null for global scope)
 * @param name Descriptive name for the scope
 * @returns New scope instance
 */
function createScope(parent: Scope | null, name: string): Scope {
    return {
        parent,
        name,
        variables: new Map(),
        functions: new Map()
    };
}

/**
 * Deferred Function Call Resolution System
 * 
 * Since function calls may reference functions declared later in the code,
 * we use a call stack to defer type checking of function calls until all
 * function declarations have been processed.
 */

/**
 * Represents an unresolved function call that needs deferred type checking
 */
interface unresolvedCall {
    node: ASTNode;                              // The function call AST node
    scope: Scope;                               // Scope where the call occurs
    assignToVar?: string | null;                // Variable being assigned to (if any)
    returnType?: string | null;                 // Expected return type (for return statements)
    branch?: string | ASTNode | null;           // Branch operand in binary expressions
    operator?: string | null;                   // Operator in binary expressions
}

// Global call stack for deferred function call resolution
let callStack: unresolvedCall[] = [];

/**
 * Pushes a simple function call onto the resolution stack
 */
function pushCall(node: ASTNode, scope: Scope) {
    callStack.push({node, scope});
}

/**
 * Pushes a function call that's being assigned to a variable
 */
function pushVarCall(node: ASTNode, scope: Scope, variable: string | null) {
    callStack.push({node, scope, assignToVar: variable});
}

/**
 * Pushes a function call in a return statement
 */
function pushReturnCall(node: ASTNode, scope: Scope, type: string | null) {
    callStack.push({node, scope, returnType: type});
}

/**
 * Pushes a function call that's part of a binary expression
 */
function pushBranchCall(node: ASTNode, scope: Scope, branch: string | null, operator: string | null) {
    callStack.push({node, scope, branch, operator});
}

/**
 * Pops and returns the most recent unresolved call
 */
function popCall(): unresolvedCall | undefined {
    return callStack.pop();
}

/**
 * Control Flow Context Tracking System
 * 
 * Tracks the current execution context to validate break and continue statements.
 * These statements are only valid within specific contexts (loops for continue,
 * loops or switch statements for break).
 */

/**
 * Represents the current execution context for control flow validation
 */
interface Context {
    inLoop: boolean;        // Whether we're currently inside a loop (for/while)
    inSwitch: boolean;      // Whether we're currently inside a switch statement
}

// Global context stack for tracking nested control structures
let contextStack: Context[] = [];

// Main semantic analysis functions

/**
 * Main entry point for semantic analysis
 * Performs two-pass analysis:
 * 1. First pass: traverse AST and collect declarations, defer function calls
 * 2. Second pass: resolve all deferred function calls
 * 
 * @param ast The Abstract Syntax Tree to analyze
 * @returns true if semantic analysis passes without errors, throws Error otherwise
 */
export function analyze(ast: AST): boolean {
    const globalScope = createScope(null, "global");
    traverse(ast.body, globalScope);
    while(callStack.length > 0) resolveCalls();
    return true;
}

/**
 * Traverses a list of AST nodes and analyzes each one
 */
function traverse(body: ASTNode[], scope: Scope) {
    for(const node of body) {
        analyzeNode(node, scope);
    }
}

/**
 * Analyzes a single AST node based on its type
 * Dispatches to appropriate specialized analysis functions
 */
function analyzeNode(node: ASTNode, scope: Scope) {
    switch (node.type) {
        case "VariableDeclaration":
            return checkVariableDeclaration(node, scope);
        case "FunctionDeclaration":
            return checkFunctionDeclaration(node, scope);
        case "ExpressionStatement":
            const exprType = checkExpression(node.expression, scope);
            if(exprType === "FunctionCall") pushCall(node.expression, scope);
            return exprType;
        case "ReturnStatement":
            return checkReturn(node, scope);
        case "IfStatement":
            return checkIfStatement(node, scope);
        case "WhileLoop":
            return checkWhileLoop(node, scope);
        case "ForLoop":
            return checkForLoop(node, scope);
        case "ControlFlowStatement":
            return checkControlFlowStatement(node);
        default:
            throw new Error(`Unknown AST node type: ${node.type}`);
    }
}

// Statement-specific analysis functions

/**
 * Validates variable declaration and type compatibility
 * Ensures the assigned value matches the declared type
 */
function checkVariableDeclaration(node: ASTNode, scope: Scope) {
    const valueType = checkExpression(node.value, scope);
    if(valueType !== "FunctionCall" && node.dataType !== valueType) throw new Error(`Type mismatch: variable ${node.name} is type ${node.dataType} but got ${valueType}`);
    if(valueType === "FunctionCall") pushVarCall(node.value, scope, node.name);
    declareVariable(scope, node.name, node.dataType);
}

/**
 * Processes function declaration by creating function scope and validating body
 * Declares function in current scope and processes parameters
 */
function checkFunctionDeclaration(node: ASTNode, scope: Scope) {
    const funcScope = createScope(scope, node.name);
    
    // Declare parameters as variables in function scope
    node.parameters.forEach((param: any) => { 
        declareVariable(funcScope, param.name, param.dataType);
    });

    // Register function in current scope
    declareFunction(scope, node.name, {
        params: node.parameters.map((params: any) => ({name: params.name, type: params.dataType})),
        returnType: node.returnType
    });

    // Analyze function body in function scope
    traverse(node.body, funcScope);
}

/**
 * Validates return statement type compatibility with function signature
 */
function checkReturn(node: ASTNode, scope: Scope) {
    const funcInfo = resolveFunction(scope, scope.name);
    const returnType = funcInfo.returnType;
    const exprType = checkExpression(node.value, scope);
    if(exprType !== "FunctionCall" && exprType !== returnType) throw new Error(`Return type mismatch: expected ${returnType} but got ${exprType}`);
    if(exprType === "FunctionCall") pushReturnCall(node.value, scope, returnType);
}

/**
 * Validates if statement structure and condition types
 * Processes main condition, if body, else-if chains, and else body
 */
function checkIfStatement(node: ASTNode, scope: Scope) {
    checkCondition(node, scope);
    checkBody(node.body, scope, "if");

    if(node.elseIfs) checkElseIfs(node, scope);
    if(node.else) checkBody(node.else, scope, "else");
}

/**
 * Processes else-if chains in if statements
 */
function checkElseIfs(node: ASTNode, scope: Scope) {
    for(const elseIf of node.elseIf) {
        checkCondition(elseIf, scope);
        checkBody(elseIf.body, scope, "else if");
    }
}

/**
 * Validates while loop condition and body
 * Pushes loop context for break/continue validation
 */
function checkWhileLoop(node: ASTNode, scope: Scope) {
    contextStack.push({ inLoop: true, inSwitch: false });
    checkCondition(node, scope);
    checkBody(node.body, scope, "while");
    contextStack.pop();
}

/**
 * Validates for loop structure including initialization, condition, and increment
 * Ensures proper types for all three components and pushes loop context
 */
function checkForLoop(node: ASTNode, scope: Scope) {
    contextStack.push({ inLoop: true, inSwitch: false });
    
    // Validate initialization is a variable declaration
    if(node.initialization.type !== "VariableDeclaration") throw new Error(`For loop initialization must be a variable declaration, got ${node.initialization.type}`);
    checkVariableDeclaration(node.initialization, scope);

    // Validate condition
    checkCondition(node, scope);

    // Validate increment is a unary expression (++ or --)
    if(node.increment.type !== "UnaryExpression") throw new Error(`For loop must have an increment or decrement (Unary Expression), got ${node.increment.type}`);
    if(node.increment.operator !== "++" && node.increment.operator !== "--") throw new Error(`For loop increment must be '++' or '--', got ${node.increment.operator}`);
    const incrementType = checkExpression(node.increment, scope);
    if(incrementType !== "int" && incrementType !== "float") throw new Error(`For loop increment must be numeric, got ${incrementType}`);
    
    checkBody(node.body, scope, "for");
    contextStack.pop();
}

/**
 * Validates that a condition expression evaluates to boolean type
 * Used by if statements, while loops, and for loops
 */
function checkCondition(node: ASTNode, scope: Scope) {
    const conditionType = checkExpression(node.condition, scope);
    if(conditionType !== "boolean" && conditionType !== "FunctionCall") throw new Error(`Condition must be boolean, got ${conditionType}`);
    if(conditionType === "FunctionCall") pushCall(node.condition, scope);
}

/**
 * Creates a new scope for a code block and analyzes all statements within it
 */
function checkBody(body: ASTNode[], scope: Scope, name: string) {
    const bodyScope = createScope(scope, name);
    traverse(body, bodyScope);
}

/**
 * Validates control flow statements (break and continue)
 * Ensures they are used in appropriate contexts:
 * - break: only in loops or switch statements
 * - continue: only in loops
 * 
 * @param node The control flow statement AST node
 * @throws Error if statement is used in invalid context
 */
function checkControlFlowStatement(node: ASTNode) {
    const currentContext = contextStack[contextStack.length - 1];

    if(node.flowType === "break") {
        if(!currentContext.inLoop && !currentContext.inSwitch) {
            throw new Error("Break statement can only be used inside a loop or switch statement.");
        }
    }

    if(node.flowType === "continue") {
        if(!currentContext.inLoop) {
            throw new Error("Continue statement can only be used inside a loop.");
        }
    }
}

/**
 * Type checks expressions and returns their evaluated type
 * Handles literals, identifiers, assignments, binary/unary operations, and function calls
 * 
 * @param expression The expression AST node to analyze
 * @param scope Current scope for variable/function resolution
 * @returns The type of the expression or "FunctionCall" for deferred resolution
 */
function checkExpression(expression: ASTNode, scope: Scope): any {
    switch(expression.type) {
        case "Literal":
            return expression.dataType;
            
        case "Identifier":
            return resolveVariable(scope, expression.name).type;
            
        case "AssignmentExpression":
            const left = expression.left;
            if(left.type !== "Identifier") throw new Error(`Invalid assignment target: ${left.type}`);
            const _rightType = checkExpression(expression.right, scope);
            if(_rightType === "FunctionCall") {
                pushVarCall(expression.right, scope, left.name);
                return null;
            }
            const varInfo = resolveVariable(scope, left.name);
            if(varInfo.type !== _rightType) throw new Error(`Type mismatch in assignment: variable ${left.name} is type ${varInfo.type} but got ${_rightType}`);
            return varInfo.type;
            
        case "BinaryExpression":
            return checkBinaryExpression(expression, scope);
            
        case "UnaryExpression":
            return checkExpression(expression.argument, scope);
            
        case "FunctionCall":
            return expression.type;
        
        default:
            throw new Error(`Unknown expression type: ${expression.type}`);
    }
}

/**
 * Type checks binary expressions and validates operator compatibility
 * Handles arithmetic, comparison, and logical operators
 */
function checkBinaryExpression(expression: ASTNode, scope: Scope): string {
    const operator = expression.operator;
    const leftType = checkExpression(expression.left, scope);
    const rightType = checkExpression(expression.right, scope);
    
    // Handle deferred function call resolution
    if(leftType === "FunctionCall" || rightType === "FunctionCall") {
        if(leftType === "FunctionCall" && rightType === "FunctionCall") pushBranchCall(expression.left, scope, expression.right, operator);
        if(rightType === "FunctionCall" && leftType !== "FunctionCall") pushBranchCall(expression.right, scope, leftType, operator);
        if(leftType === "FunctionCall" && rightType !== "FunctionCall") pushBranchCall(expression.left, scope, rightType, operator);
    }
    
    // Type compatibility check for non-function calls
    if(leftType !== rightType && (leftType !== "FunctionCall" && rightType !== "FunctionCall")) {
        throw new Error(`Type mismatch in expression: ${leftType} and ${rightType}`);
    }
    
    // Comparison operators always return boolean
    if(["==", "!=", "<", ">", "<=", ">="].includes(operator)) return "boolean";
    
    // Logical operators require boolean operands and return boolean
    if(["&&", "||"].includes(operator)) {
        if((leftType !== "boolean" || rightType !== "boolean") && (leftType !== "FunctionCall" && rightType !== "FunctionCall")) 
            throw new Error(`Logical operators require boolean operands, got ${leftType}`);
        return "boolean";
    }
    
    // Arithmetic operators require numeric operands
    if(["+", "-", "*", "/", "^", "%"].includes(operator)) {
        if(((leftType !== "int" && leftType !== "float") || (rightType !== "int" && rightType !== "float")) && (leftType !== "FunctionCall" && rightType !== "FunctionCall")) 
            throw new Error(`Arithmetic operators require numeric operands, got ${leftType}`);
        return leftType === "FunctionCall" ? "int" : leftType;
    }
    
    return leftType;
}

// Deferred function call resolution system

/**
 * Resolves a deferred function call by validating its signature and context
 * Called during the second pass of semantic analysis
 * 
 * @returns The return type of the resolved function
 */
function resolveCalls() {
    const call = popCall()!;
    const funcInfo = resolveFunction(call.scope, call.node.name);
    checkCallArguments(funcInfo, call);
    if(call.assignToVar) checkVariableType(funcInfo, call);
    if(call.returnType) checkReturnType(funcInfo, call);
    if(call.branch) checkBranch(funcInfo, call);
    return funcInfo.returnType;
}

/**
 * Validates function call arguments against function parameter signature
 * Ensures correct number and types of arguments
 */
function checkCallArguments(funcInfo: FunctionInfo, call: any) {
    if(funcInfo.params.length !== call.node.arguments.length) throw new Error(`Function '${call.node.name}' called with incorrect number of arguments.`);
    for(let i = 0; i < funcInfo.params.length; i++) {
        const param = funcInfo.params[i];
        const arg = call.node.arguments[i];
        if(!arg) throw new Error(`Missing argument for function '${call.node.name}' at position ${i}.`);
        let argType = checkExpression(arg, call.scope);
        if(argType === "FunctionCall") {
            pushCall(arg, call.scope);
            argType = resolveCalls();
        }
        if(argType !== param.type) throw new Error(`Argument type mismatch for '${param.name}': expected ${param.type} but got ${argType}.`);
    }
}

/**
 * Validates that function return type matches variable being assigned to
 */
function checkVariableType(funcInfo: FunctionInfo, call: any) {
    const varInfo = resolveVariable(call.scope, call.assignToVar);
    if(varInfo.type !== funcInfo.returnType) throw new Error(`Variable '${call.assignToVar}' type mismatch: expected ${funcInfo.returnType} but got ${varInfo.type}`);
}

/**
 * Validates that function return type matches expected return type
 */
function checkReturnType(funcInfo: FunctionInfo, call: any) {
    if(call.returnType !== funcInfo.returnType) throw new Error(`Return type mismatch: expected ${funcInfo.returnType} but got ${call.returnType}`);
}

/**
 * Validates function call in binary expression context
 * Checks type compatibility with the other operand and operator requirements
 */
function checkBranch(funcInfo: FunctionInfo, call: any) {
    const branchType = call.branch?.type || call.branch;
    if(branchType === "FunctionCall") {
        pushCall(call.branch, call.scope);
        const _branchType = resolveCalls();
        if(funcInfo.returnType !== _branchType) throw new Error(`Branch type mismatch: expected ${funcInfo.returnType} but got ${_branchType}`);
        checkOperator(funcInfo, call, _branchType);
    }
    if(branchType !== "FunctionCall" && branchType !== funcInfo.returnType) throw new Error(`Branch type mismatch: expected ${funcInfo.returnType} but got ${branchType}`);
    if(branchType !== "FunctionCall") checkOperator(funcInfo, call, branchType);
}

/**
 * Validates operator compatibility with operand types in binary expressions
 * Ensures logical operators work with booleans, arithmetic with numbers, etc.
 */
function checkOperator(funcInfo: FunctionInfo, call: any, branchType: string | ASTNode | null) {
    switch(call.operator) {
        case "&&":
        case "||":
            if(branchType !== "boolean" || funcInfo.returnType !== "boolean") throw new Error(`Logical operator '${call.operator}' requires boolean return type, got ${branchType}`);
        break;
        case "+":
        case "-":
        case "*":
        case "/":
        case "^":
        case "%":
            if((branchType !== "int" && branchType !== "float") || (funcInfo.returnType !== "int" && funcInfo.returnType !== "float")) 
                throw new Error(`Arithmetic operator '${call.operator}' requires numeric return type, got ${branchType}`);
        break;
        case "==":
        case "!=":
        case "<":
        case ">":
        case "<=":
        case ">=":
            return;
        default:
            throw new Error(`Unknown operator '${call.operator}' in branch.`);
    }
}