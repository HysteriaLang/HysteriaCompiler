import { AST, ASTNode } from './parser';

// Scope
type VariableInfo = {
    type: string;
};

type FunctionInfo = {
    params: {name: string, type: string}[];
    returnType: string;
};

interface Scope {
    parent?: Scope | null;
    name: string;
    variables: Map<string, VariableInfo>;
    functions: Map<string, FunctionInfo>;
}

function declareVariable(scope: Scope, name: string, type: string): void {
    if (scope.variables.has(name)) throw new Error(`Variable '${name}' already declared in this scope.`);
    scope.variables.set(name, { type });
}

function resolveVariable(scope: Scope, name: string): VariableInfo {
    if (scope.variables.has(name)) return scope.variables.get(name)!;
    if (scope.parent) return resolveVariable(scope.parent, name);
    throw new Error(`Variable '${name}' is not defined.`);
}

function declareFunction(scope: Scope, name: string, info: FunctionInfo): void {
    if (scope.functions.has(name)) throw new Error(`Function '${name}' already declared in this scope.`);
    scope.functions.set(name, info);
}

function resolveFunction(scope: Scope, name: string): FunctionInfo {
    if (scope.functions.has(name)) return scope.functions.get(name)!;
    if (scope.parent) return resolveFunction(scope.parent, name);
    throw new Error(`Function '${name}' is not defined.`);
}

function createScope(parent: Scope | null, name: string): Scope {
    return {
        parent,
        name,
        variables: new Map(),
        functions: new Map()
    };
}

// Call Stack
interface unresolvedCall {
    node: ASTNode;
    scope: Scope;
    assignToVar?: string | null;
    returnType?: string | null;
    branch?: string | ASTNode | null;
    operator?: string | null;
}

let callStack: unresolvedCall[] = [];

function pushCall(node: ASTNode, scope: Scope) {
    callStack.push({node, scope});
}

function pushVarCall(node: ASTNode, scope: Scope, variable: string | null) {
    callStack.push({node, scope, assignToVar: variable});
}

function pushReturnCall(node: ASTNode, scope: Scope, type: string | null) {
    callStack.push({node, scope, returnType: type});
}

function pushBranchCall(node: ASTNode, scope: Scope, branch: string | null, operator: string | null) {
    callStack.push({node, scope, branch, operator});
}

function popCall(): unresolvedCall | undefined {
    return callStack.pop();
}

// Semantic Analysis Functions
export function analyze(ast: AST) {
    const globalScope = createScope(null, "global");
    traverse(ast.body, globalScope);
    while(callStack.length > 0) resolveCalls();
}

function traverse(body: ASTNode[], scope: Scope) {
    for(const node of body) {
        analyzeNode(node, scope);
    }
}

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
        default:
            throw new Error(`Unknown AST node type: ${node.type}`);
    }
}

function checkVariableDeclaration(node: ASTNode, scope: Scope) {
    const valueType = checkExpression(node.value, scope);
    if(valueType !== "FunctionCall" && node.dataType !== valueType) throw new Error(`Type mismatch: variable ${node.name} is type ${node.dataType} but got ${valueType}`);
    if(valueType === "FunctionCall") pushVarCall(node.value, scope, node.name);
    declareVariable(scope, node.name, node.dataType);
}

function checkFunctionDeclaration(node: ASTNode, scope: Scope) {
    const funcScope = createScope(scope, node.name);
    node.parameters.forEach((param: any) => { 
        declareVariable(funcScope, param.name, param.dataType);
    });

    declareFunction(scope, node.name, {
        params: node.parameters.map((params: any) => ({name: params.name, type: params.dataType})),
        returnType: node.returnType
    });

    traverse(node.body, funcScope);
}

function checkReturn(node: ASTNode, scope: Scope) {
    const funcInfo = resolveFunction(scope, scope.name);
    const returnType = funcInfo.returnType;
    const exprType = checkExpression(node.value, scope);
    if(exprType !== "FunctionCall" && exprType !== returnType) throw new Error(`Return type mismatch: expected ${returnType} but got ${exprType}`);
    if(exprType === "FunctionCall") pushReturnCall(node.value, scope, returnType);
}

function checkIfStatement(node: ASTNode, scope: Scope) {
    const conditionType = checkExpression(node.condition, scope);
    if(conditionType !== "boolean" && conditionType !== "FunctionCall") throw new Error(`If condition must be boolean, got ${conditionType}`);
    if(conditionType === "FunctionCall") pushCall(node.condition, scope);

    const ifScope = createScope(scope, "if");
    traverse(node.body, ifScope);

    if(node.elseIfs) checkElseIfs(node, scope);
    if(node.else) checkElse(node, scope);
}

function checkElseIfs(node: ASTNode, scope: Scope) {
    for(const elseIf of node.elseIf) {
        const elseIfConditionType = checkExpression(elseIf.condition, scope);
        if(elseIfConditionType !== "boolean" && elseIfConditionType !== "FunctionCall") throw new Error(`Else If condition must be boolean, got ${elseIfConditionType}`);
        if(elseIfConditionType === "FunctionCall") pushCall(elseIf.condition, scope);

        const elseIfScope = createScope(scope, "else if");
        traverse(elseIf.body, elseIfScope);
    }
}

function checkElse(node: ASTNode, scope: Scope) {
    const elseScope = createScope(scope, "else");
    traverse(node.else, elseScope);
}

function checkWhileLoop(node: ASTNode, scope: Scope) {
    // check the condition
    // check the body
    // ensure no infinite loop
}

function checkForLoop(node: ASTNode, scope: Scope) {
    // check initialization
    // check condition
    // check increment or decrement
    // check body
    // ensure no infinite loop
}

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
            const operator = expression.operator;
            const leftType = checkExpression(expression.left, scope);
            const rightType = checkExpression(expression.right, scope);
            if(leftType === "FunctionCall" || rightType === "FunctionCall") {
                if(leftType === "FunctionCall" && rightType === "FunctionCall") pushBranchCall(expression.left, scope, expression.right, operator);
                if(rightType === "FunctionCall" && leftType !== "FunctionCall") pushBranchCall(expression.right, scope, leftType, operator);
                if(leftType === "FunctionCall" && rightType !== "FunctionCall") pushBranchCall(expression.left, scope, rightType, operator);
            }
            if(leftType !== rightType && (leftType !== "FunctionCall" && rightType !== "FunctionCall")) throw new Error(`Type mismatch in expression: ${leftType} and ${rightType}`);
            if(["==", "!=", "<", ">", "<=", ">="].includes(operator)) return "boolean";
            if(["&&", "||"].includes(operator)) {
                if((leftType !== "boolean" || rightType !== "boolean") && (leftType !== "FunctionCall" && rightType !== "FunctionCall")) 
                    throw new Error(`Logical operators require boolean operands, got ${leftType}`);
                return "boolean";
            }
            if(["+", "-", "*", "/", "^", "%"].includes(operator)) {
                if(((leftType !== "int" && leftType !== "float") || (rightType !== "int" && rightType !== "float")) && (leftType !== "FunctionCall" && rightType !== "FunctionCall")) 
                    throw new Error(`Arithmetic operators require numeric operands, got ${leftType}`);
                return leftType === "FunctionCall" ? "int" : leftType;
            }
        case "UnaryExpression":
            return checkExpression(expression.argument, scope);
        case "FunctionCall":
            return expression.type;
        default:
            throw new Error(`Unknown expression type: ${expression.type}`);
    }
}

// Resolve Calls
function resolveCalls() {
    const call = popCall()!;
    const funcInfo = resolveFunction(call.scope, call.node.name);
    checkCallArguments(funcInfo, call);
    if(call.assignToVar) checkVariableType(funcInfo, call);
    if(call.returnType) checkReturnType(funcInfo, call);
    if(call.branch) checkBranch(funcInfo, call);
    return funcInfo.returnType;
}

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

function checkVariableType(funcInfo: FunctionInfo, call: any) {
    const varInfo = resolveVariable(call.scope, call.assignToVar);
    if(varInfo.type !== funcInfo.returnType) throw new Error(`Variable '${call.assignToVar}' type mismatch: expected ${funcInfo.returnType} but got ${varInfo.type}`);
}

function checkReturnType(funcInfo: FunctionInfo, call: any) {
    if(call.returnType !== funcInfo.returnType) throw new Error(`Return type mismatch: expected ${funcInfo.returnType} but got ${call.returnType}`);
}

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
