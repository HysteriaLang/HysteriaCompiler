import { Token } from './tokenizer';

/**
 * Represents a node in the Abstract Syntax Tree
 */
export interface ASTNode {
    type: string;           // The type of AST node (e.g., "BinaryExpression", "IfStatement")
    [key: string]: any;     // Additional properties specific to each node type
}

/**
 * Root AST structure representing the entire program
 */
export interface AST {
    type: string;           // Always "Program" for the root node
    start: number;          // Starting line number
    end: number;            // Ending line number
    body: ASTNode[];        // Array of top-level statements
}

/**
 * Operator precedence table using Pratt parsing binding powers
 * Each operator maps to [left_binding_power, right_binding_power]
 * Higher numbers = higher precedence
 */
const BINDING_POWER: Record<string, [number, number]> = {
    // Logical operators (lowest precedence)
    "||": [0, 0.1],         // Logical OR
    "&&": [1, 1.1],         // Logical AND

    // Equality operators
    "==": [2, 2.1],         // Equal to
    "!=": [2, 2.1],         // Not equal to

    // Relational operators
    "<": [3, 3.1],          // Less than
    "<=": [3, 3.1],         // Less than or equal
    ">": [3, 3.1],          // Greater than
    ">=": [3, 3.1],         // Greater than or equal

    // Arithmetic operators
    "+": [4, 4.1],          // Addition
    "-": [4, 4.1],          // Subtraction
    "*": [5, 5.1],          // Multiplication
    "/": [5, 5.1],          // Division
    "%": [5, 5.1],          // Modulo

    // Exponentiation (right-associative)
    "^": [6.1, 6],

    // Increment/decrement (highest precedence)
    "++": [7, 7.1],         // Increment
    "--": [7, 7.1],         // Decrement
};

// Global parser state
let state = { current: 0 };

/**
 * Main parser function that converts tokens into an Abstract Syntax Tree
 * @param tokens Array of tokens from the tokenizer
 * @returns Complete AST representing the program structure
 */
export function parse(tokens: Token[]): AST {
    let numOfLines = tokens[tokens.length - 1].line;

    let AST: AST = {
        type: "Program",
        start: 1,
        end: numOfLines,
        body: []
    }

    // Parse all top-level statements
    for(let i = state.current; i < tokens.length; i++) {
        AST.body.push(parseStatement(tokens));
        i = state.current;
    }

    return AST;
}

/**
 * Parses a single statement and returns corresponding AST node
 * Handles all statement types: control flow, declarations, and expressions
 */
function parseStatement(tokens: Token[]): ASTNode {
    const token = peek(tokens, state);
    if(!token) return {type: "End of File"}

    // Control flow statements
    if(token.type === "keyword" && token.lexeme === "if") return parseIfStatement(tokens, state);
    if(token.type === "keyword" && token.lexeme === "while") return parseWhileLoop(tokens, state);
    if(token.type === "keyword" && token.lexeme === "for") return parseForLoop(tokens, state);
    if(token.type === "keyword" && token.lexeme === "return") return parseReturn(tokens, state);
    if(token.type === "keyword" && (token.lexeme === "break" || token.lexeme === "continue")) return parseControlFlow(tokens, state);

    // Declarations (functions and variables)
    if(token.type === "type" && isType(token.lexeme)) {
        const next = peek(tokens, state, 1);
        if(next.type === "keyword" && next.lexeme === "function") {
            return parseFunctionDeclaration(tokens, state);
        }else{
            return parseVariableDeclaration(tokens, state);
        }
    }

    // Expression statements (assignments, function calls, etc.)
    const expr = parseExpression(tokens, state);
    expect(tokens, state, ";");
    return {
        type: "ExpressionStatement",
        expression: expr
    };
}

// Utility functions for token navigation and validation

/**
 * Looks ahead at a token without consuming it
 * @param offset Number of tokens to look ahead (default: 0 for current)
 */
function peek(tokens: Token[], state: {current: number}, offset: number = 0): Token {
    return tokens[state.current + offset];
}

/**
 * Consumes and returns the current token, advancing the parser state
 */
function consume(tokens: Token[], state: {current: number}): Token {
    return tokens[state.current++];
}

/**
 * Expects a specific token and consumes it, throwing error if not found
 * @param expectedType The expected token lexeme
 */
function expect(tokens: Token[], state: {current: number}, expectedType: string): Token {
    const token = peek(tokens, state);
    if(!token) throw new Error(`Unexpected end of input, expected '${expectedType}'`);
    if(token.lexeme !== expectedType) {
        throw new Error(`Expected '${expectedType}', found '${token.lexeme}', line ${token.line}, column ${token.column}`);
    }
    return consume(tokens, state);
}

/**
 * Checks if a string represents a valid data type
 */
function isType(word: string): boolean {
    return ["int", "string", "float", "void", "boolean"].includes(word);
}

// Statement parsing functions

/**
 * Parses if-else statement with optional else-if chains
 * Syntax: if (condition) { body } [else if (condition) { body }]* [else { body }]?
 */
function parseIfStatement(tokens: Token[], state: {current: number}): ASTNode {
    expect(tokens, state, "if");

    // Parse condition
    expect(tokens, state, "(");
    const condition: any = parseExpression(tokens, state);
    expect(tokens, state, ")");

    // Parse main body
    expect(tokens, state, "{");
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}");

    // Parse optional else-if chains
    let elseIf: any[] = [];
    while(peek(tokens, state)?.lexeme === "else if") {
        expect(tokens, state, "else if");

        expect(tokens, state, "(");
        const elseIfCondition: any = parseExpression(tokens, state);
        expect(tokens, state, ")");

        expect(tokens, state, "{");
        const elseIfBody: any[] = parseBody(tokens, state);
        expect(tokens, state, "}");

        elseIf.push({
            condition: elseIfCondition,
            body: elseIfBody
        });
    }

    // Parse optional else clause
    let elseBody: any[] = [];
    if(peek(tokens, state)?.lexeme === "else") {
        expect(tokens, state, "else");
        expect(tokens, state, "{");
        elseBody = parseBody(tokens, state);
        expect(tokens, state, "}");
    }

    return {
        type: "IfStatement",
        condition: condition,
        body: body,
        elseIf: elseIf,
        else: elseBody
    }
}

/**
 * Parses while loop statement
 * Syntax: while (condition) { body }
 */
function parseWhileLoop(tokens: Token[], state: {current: number}): ASTNode {
    expect(tokens, state, "while");

    // Parse condition
    expect(tokens, state, "(");
    const condition: any = parseExpression(tokens, state);
    expect(tokens, state, ")");

    // Parse body
    expect(tokens, state, "{");
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}");

    return {
        type: "WhileLoop",
        condition: condition,
        body: body
    }
}

/**
 * Parses for loop statement
 * Syntax: for (initialization; condition; increment) { body }
 */
function parseForLoop(tokens: Token[], state: {current: number}): ASTNode {
    expect(tokens, state, "for");
    expect(tokens, state, "(");

    // Parse three parts of for loop
    const init = parseVariableDeclaration(tokens, state);
    const condition = parseExpression(tokens, state);
    expect(tokens, state, ";");
    const increment = parseExpression(tokens, state);
    expect(tokens, state, ")");

    // Parse body
    expect(tokens, state, "{");
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}");

    return {
        type: "ForLoop",
        initialization: init,
        condition: condition,
        increment: increment,
        body: body
    };
}

/**
 * Parses control flow statements (break/continue)
 * Syntax: break; | continue;
 */
function parseControlFlow(tokens: Token[], state: {current: number}): ASTNode {
    const token = peek(tokens, state).lexeme;
    expect(tokens, state, token);
    expect(tokens, state, ";");
    
    return {
        type: "ControlFlowStatement",
        flowType: token
    }
}

/**
 * Parses return statement
 * Syntax: return expression;
 */
function parseReturn(tokens: Token[], state: {current: number}): ASTNode {
    expect(tokens, state, "return");
    const value = parseExpression(tokens, state);
    expect(tokens, state, ";");
    return {
        type: "ReturnStatement",
        value: value
    };
}

/**
 * Parses function declaration
 * Syntax: returnType function name(param1Type param1Name, ...) { body }
 */
function parseFunctionDeclaration(tokens: Token[], state: {current: number}): ASTNode {
    const returnType = consume(tokens, state);
    if(!isType(returnType.lexeme)) throw new Error(`Expected a valid return type, found '${returnType.lexeme}', at line ${returnType.line}, column ${returnType.column}`);
    expect(tokens, state, "function")
    const functionName = consume(tokens, state);
    if(functionName.type !== "identifier") throw new Error(`Expected a function name, found '${functionName.lexeme}', at line ${functionName.line}, column ${functionName.column}`);

    // Parse parameter list
    expect(tokens, state, "(");
    const params: any[] = [];
    while(peek(tokens, state)?.lexeme !== ")") {
        const paramType = consume(tokens, state);
        if(!isType(paramType.lexeme)) throw new Error(`Expected a valid parameter type, found '${paramType.lexeme}', at line ${paramType.line}, column ${paramType.column}`);

        const paramName = consume(tokens, state);
        if(paramName.type !== "identifier") throw new Error(`Expected a parameter name, found '${paramName.lexeme}', at line ${paramName.line}, column ${paramName.column}`);

        params.push({dataType: paramType.lexeme, name: paramName.lexeme});
        if(peek(tokens, state)?.lexeme === ",") expect(tokens, state, ",");
    }
    expect(tokens, state, ")");

    // Parse function body
    expect(tokens, state, "{");
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}");

    return {
        type: "FunctionDeclaration",
        returnType: returnType.lexeme,
        name: functionName.lexeme,
        parameters: params,
        body: body
    };
}

/**
 * Parses variable declaration with initialization
 * Syntax: type name = expression;
 */
function parseVariableDeclaration(tokens: Token[], state: {current: number}): ASTNode {
    const type = consume(tokens, state);
    if(!isType(type.lexeme)) throw new Error(`Expected a valid variable type, found '${type.lexeme}', at line ${type.line}, column ${type.column}`);
    const name = consume(tokens, state);
    if(name.type !== "identifier") throw new Error(`Expected a variable name, found '${name.lexeme}', at line ${name.line}, column ${name.column}`);
    expect(tokens, state, "=");
    const value = parseExpression(tokens, state);
    expect(tokens, state, ";");
    return {
        type: "VariableDeclaration",
        dataType: type.lexeme,
        name: name.lexeme,
        value: value
    };
}

/**
 * Parses a block body (sequence of statements until closing brace)
 */
function parseBody(tokens: Token[], state: {current: number}): ASTNode[] {
    let body: any[] = [];
    while(peek(tokens, state)?.lexeme !== "}") {
        body.push(parseStatement(tokens));
    }
    return body;
}

/**
 * Parses expressions using Pratt parsing (operator precedence parsing)
 * Handles literals, identifiers, function calls, assignments, and binary operations
 * @param minBP Minimum binding power for operator precedence
 */
function parseExpression(tokens: Token[], state: {current: number}, minBP: number = 0): ASTNode {
    let token = consume(tokens, state);
    let left: any;

    // Null Denotation (NUD) - handles prefix expressions and primary expressions
    if(isType(token.type)) {
        // Literal values
        left = {type: "Literal", dataType: token.type, name: token.lexeme};
    }
    else if(token.type === "identifier") {
        // Function calls, assignments, or simple identifiers
        if(peek(tokens, state)?.lexeme === "(") {
            // Function call: identifier(args...)
            expect(tokens, state, "(");
            const args: any[] = [];
            while(peek(tokens, state)?.lexeme !== ")") {
                args.push(parseExpression(tokens, state))
                if(peek(tokens, state)?.lexeme === ",") expect(tokens, state, ",");
            }
            expect(tokens, state, ")");
            left = {
                type: "FunctionCall",
                name: token.lexeme,
                arguments: args
            };
        }
        else if(peek(tokens, state)?.lexeme === "=") {
            // Variable assignment: identifier = expression
            expect(tokens, state, "=");
            const value = parseExpression(tokens, state);
            left = {
                type: "AssignmentExpression",
                operator: "=",
                left: {type: "Identifier", name: token.lexeme},
                right: value
            };
        }
        else{
            // Simple identifier reference
            left = {type: "Identifier", name: token.lexeme};
        }
    }
    else if(token.lexeme === "(") {
        // Parenthesized expression
        left = parseExpression(tokens, state);
        expect(tokens, state, ")");
    }
    else if(token.type === "operator" && (token.lexeme === "++" || token.lexeme === "--")) {
        // Prefix increment/decrement
        const op = token.lexeme;
        const argument = parseExpression(tokens, state, BINDING_POWER[op][1]);
        left = {
            type: "UnaryExpression",
            operator: op,
            argument: argument,
            prefix: true
        };
    }
    else{
        throw new Error(`Unexpected token: ${token.lexeme}`);
    }

    // Left Denotation (LED) - handles infix and postfix expressions
    while(true) {
        const op = peek(tokens, state);
        if(!op || !(op.lexeme in BINDING_POWER)) break;

        // Postfix increment/decrement
        if(op.lexeme === "++" || op.lexeme === "--") {
            expect(tokens, state, op.lexeme);
            left = {
                type: "UnaryExpression",
                operator: op.lexeme,
                argument: left,
                prefix: false
            };
            continue;
        }

        // Check binding power for operator precedence
        const [leftBP, rightBP] = BINDING_POWER[op.lexeme] || [0,0];
        if(leftBP < minBP) break;
        
        // Binary operations
        expect(tokens, state, op.lexeme);
        const right = parseExpression(tokens, state, rightBP);

        left = {
            type: "BinaryExpression",
            operator: op.lexeme,
            left: left,
            right: right
        };
    }

    return left;
}
