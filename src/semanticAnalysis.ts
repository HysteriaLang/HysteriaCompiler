import { AST, ASTNode } from './parser';

type VariableInfo = {
    type: string;
};

type FunctionInfo = {
    returnType: string;
    params: [];
};

interface Scope {
    parent?: Scope | null;
    variables: Map<string, VariableInfo>;
    functions: Map<string, FunctionInfo>;
}

const state = { current: 0 };
const stack = [];

export function analyze(ast: AST) {
    let currentScope = createScope(null);

    for (let i = 0; i < ast.body.length; i++) {
        const node = ast.body[i];
        analyzeNode(node, currentScope)
    }
}

function analyzeNode(node: ASTNode, scope: Scope) {
    switch (node.type) {
        case "VariableDeclaration":
            return checkVariableDeclaration(node, scope);
        case "FunctionDeclaration":
            return checkFunctionDeclaration(node, scope);
        case "ExpressionStatement":
            return checkExpression(node.expression, scope);
        case "IfStatement":
            return checkIfStatement(node, scope);
        case "WhileLoop":
        case "ForLoop":
            return checkLoop(node, scope);
        default:
            throw new Error(`Unknown node type: ${node.type}`);
    }
}

function createScope(parent: Scope | null): Scope {
    return {
        parent,
        variables: new Map(),
        functions: new Map()
    };
}

function resolveType(value: any, scope: Scope): string | null {
    switch(value.type) {
        case "Literal":
            return value.dataType;
        case "Identifier":
            const variable = resolveVariable(value.name, scope);
            return variable.type;
        case "FunctionCall":
            stack.push(value);
            return "FunctionCall";
        case "BinaryExpression":
            const leftType = resolveType(value.left, scope);
            const rightType = resolveType(value.right, scope);
            if(leftType !== rightType) throw new Error(`Type mismatch in binary expression: ${leftType} vs ${rightType}`);
            return leftType;
        case "UnaryExpression":
            if(value.argument.type === "Identifier") {
                const variable = resolveVariable(value.argument.name, scope);
                return variable.type;
            }else{
                return value.argument.dataType;
            }
       default:
        return null;
    }
}

function resolveVariable(name: string, scope: Scope): any {
    if(scope.variables.has(name)) return scope.variables.get(name);
    if(scope.parent) return resolveVariable(name, scope.parent);
    throw new Error(`Undefined variable: ${name}`);
}

function declareVariable(name: string, type: string, scope: Scope) {
    if(scope.variables.has(name)) throw new Error(`Variable ${name} already declared in this scope.`);
    scope.variables.set(name, { type });
}

function declareFunction(name: string, type: string, parameters: any, scope: Scope) {
    if(scope.functions.has(name)) throw new Error(`Function ${name} already declared in this scope.`);
    scope.functions.set(name, { returnType: type, params: parameters });
}

function checkVariableDeclaration(node: ASTNode, scope: Scope) {
    const name = node.name;
    const dataType = node.dataType;
    const value = node.value;

    const resolvedType = resolveType(value, scope);
    if(resolvedType !== "FunctionCall" && resolvedType !== dataType) throw new Error(`Type mismatch: expected ${dataType} got ${resolvedType}`);
    declareVariable(name, dataType, scope);
}

function checkFunctionDeclaration(node: ASTNode, scope: Scope) {
    const name = node.name;
    const returnType = node.returnType;
    const parameters = node.parameters;

    declareFunction(name, returnType, parameters, scope);
}

function checkIfStatement(node: ASTNode, scope: Scope) {
}

function checkLoop(node: ASTNode, scope: Scope) {
}

function checkExpression(expr: any, scope: Scope) {
}

