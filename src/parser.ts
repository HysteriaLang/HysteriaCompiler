import { Token } from './tokenizer';

export interface ASTNode {
    type: string;
    [key: string]: any;
}

export interface AST {
    type: string;
    start: number;
    end: number;
    body: ASTNode[];
}

// still need to handle
// ! - not
// += - plus equals
// // -= - minus equals
// // *= - times equals
// // /= - divide equals
// // %= - mod equals
// // ternary operator ? :
const BINDING_POWER: Record<string, [number, number]> = {
    // logical
    "||": [0, 0.1],
    "&&": [1, 1.1],

    // equality
    "==": [2, 2.1],
    "!=": [2, 2.1],

    // comparison
    "<": [3, 3.1],
    "<=": [3, 3.1],
    ">": [3, 3.1],
    ">=": [3, 3.1],

    // arithmetic
    "+": [4, 4.1],
    "-": [4, 4.1],
    "*": [5, 5.1],
    "/": [5, 5.1],
    "%": [5, 5.1],

    // exponentiation
    "^": [6.1, 6],

    // increment/decrement
    "++": [7, 7.1],
    "--": [7, 7.1],
};

let state = { current: 0 };

export function parse(tokens: Token[]): AST {
    let numOfLines = tokens[tokens.length - 1].line;

    let AST: AST = {
        type: "Program",
        start: 1,
        end: numOfLines,
        body: []
    }

    for(let i = state.current; i < tokens.length; i++) {
        AST.body.push(parseStatement(tokens));
        i = state.current;
    }

    return AST;
}

function parseStatement(tokens: Token[]): ASTNode {
    const token = peek(tokens, state);
    if(!token) return {type: "End of File"}

    // Match if statements
    if(token.type === "keyword" && token.lexeme === "if") return parseIfStatement(tokens, state);

    // Match while loops
    if(token.type === "keyword" && token.lexeme === "while") return parseWhileLoop(tokens, state);

    // Match for loops
    if(token.type === "keyword" && token.lexeme === "for") return parseForLoop(tokens, state);

    if(token.type === "keyword" && token.lexeme === "return") return parseReturn(tokens, state);

    // Match break and continue
    if(token.type === "keyword" && (token.lexeme === "break" || token.lexeme === "continue")) return parseControlFlow(tokens, state);

    // Match function declarations and variable declaraion
    if(token.type === "type" && isType(token.lexeme)) {
        const next = peek(tokens, state, 1);
        if(next.type === "keyword" && next.lexeme === "function") {
            return parseFunctionDeclaration(tokens, state);
        }else{
            return parseVariableDeclaration(tokens, state);
        }
    }

    // Match expression statements
    const expr = parseExpression(tokens, state);
    expect(tokens, state, ";"); // expect semicolon
    return {
        type: "ExpressionStatement",
        expression: expr
    };
}

function peek(tokens: Token[], state: {current: number}, offset: number = 0): Token {
    return tokens[state.current + offset];
}

function consume(tokens: Token[], state: {current: number}): Token {
    return tokens[state.current++];
}

function expect(tokens: Token[], state: {current: number}, expectedType: string): Token {
    const token = peek(tokens, state);
    if(!token) throw new Error(`Unexpected end of input, expected '${expectedType}'`);
    if(token.lexeme !== expectedType) {
        throw new Error(`Expected '${expectedType}', found '${token.lexeme}', line ${token.line}, column ${token.column}`);
    }
    return consume(tokens, state);
}

function isType(word: string): boolean {
    return ["int", "string", "float", "void", "boolean"].includes(word);
}

function parseIfStatement(tokens: Token[], state: {current: number}): ASTNode {
    // hande if
    expect(tokens, state, "if"); // consume if

    // Handle condition
    expect(tokens, state, "("); // consume (
    const condition: any = parseExpression(tokens, state);
    expect(tokens, state, ")"); // consume )

    // Handle body
    expect(tokens, state, "{"); // consume {
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}"); // consume }

    // Handle else if
    let elseIf: any[] = [];
    while(peek(tokens, state)?.lexeme === "else if") {
        expect(tokens, state, "else if"); // consume else if

        // Handle else if condition
        expect(tokens, state, "("); // consume (
        const elseIfCondition: any = parseExpression(tokens, state);
        expect(tokens, state, ")"); // consume )

        // Handle else if body
        expect(tokens, state, "{"); // consume {
        const elseIfBody: any[] = parseBody(tokens, state);
        expect(tokens, state, "}"); // consume }

        elseIf.push({
            condition: elseIfCondition,
            body: elseIfBody
        });
    }

    // Handle else
    let elseBody: any[] = [];
    if(peek(tokens, state)?.lexeme === "else") {
        // Handle else body
        expect(tokens, state, "else"); // consume else
        expect(tokens, state, "{"); // consume {
        elseBody = parseBody(tokens, state);
        expect(tokens, state, "}"); // consume }
    }

    return {
        type: "IfStatement",
        condition: condition,
        body: body,
        elseIf: elseIf,
        else: elseBody
    }
}

function parseWhileLoop(tokens: Token[], state: {current: number}): ASTNode {
    expect(tokens, state, "while"); // consume while

    // Handle condition
    expect(tokens, state, "("); // consume (
    const condition: any = parseExpression(tokens, state);
    expect(tokens, state, ")"); // consume )

    // Handle body
    expect(tokens, state, "{"); // consume {
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}"); // consume }

    return {
        type: "WhileLoop",
        condition: condition,
        body: body
    }
}

function parseForLoop(tokens: Token[], state: {current: number}): ASTNode {
    expect(tokens, state, "for"); // consume for
    expect(tokens, state, "("); // consume (

    // Handle Initialization
    const init = parseVariableDeclaration(tokens, state);

    // Handle Condition
    const condition = parseExpression(tokens, state);
    expect(tokens, state, ";"); // consume ;

    // Handle Increment
    const increment = parseExpression(tokens, state);
    expect(tokens, state, ")"); // consume )

    // Handle body
    expect(tokens, state, "{"); // consume {
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}"); // consume }

    return {
        type: "ForLoop",
        initialization: init,
        condition: condition,
        increment: increment,
        body: body
    };
}

function parseControlFlow(tokens: Token[], state: {current: number}): ASTNode {
    const token = peek(tokens, state).lexeme;
    expect(tokens, state, token); // consume break or continue
    expect(tokens, state, ";"); // consume ;
    
    return {
        type: "ControlFlowStatement",
        flowType: token // either "break" or "continue"
    }
}

function parseReturn(tokens: Token[], state: {current: number}): ASTNode {
    expect(tokens, state, "return"); // consume return
    const value = parseExpression(tokens, state);
    expect(tokens, state, ";"); // consume ;
    return {
        type: "ReturnStatement",
        value: value
    };
}

function parseFunctionDeclaration(tokens: Token[], state: {current: number}): ASTNode {
    const returnType = consume(tokens, state); // consume return type
    if(!isType(returnType.lexeme)) throw new Error(`Expected a valid return type, found '${returnType.lexeme}', at line ${returnType.line}, column ${returnType.column}`);
    expect(tokens, state, "function") // consume function
    const functionName = consume(tokens, state); // consume function name
    if(functionName.type !== "identifier") throw new Error(`Expected a function name, found '${functionName.lexeme}', at line ${functionName.line}, column ${functionName.column}`);

    // Handle parameters
    expect(tokens, state, "("); // consume (
    const params: any[] = [];
    while(peek(tokens, state)?.lexeme !== ")") {
        const paramType = consume(tokens, state); // consume parameter type
        if(!isType(paramType.lexeme)) throw new Error(`Expected a valid parameter type, found '${paramType.lexeme}', at line ${paramType.line}, column ${paramType.column}`);

        const paramName = consume(tokens, state); // consume parameter name
        if(paramName.type !== "identifier") throw new Error(`Expected a parameter name, found '${paramName.lexeme}', at line ${paramName.line}, column ${paramName.column}`);

        params.push({dataType: paramType.lexeme, name: paramName.lexeme});
        if(peek(tokens, state)?.lexeme === ",") expect(tokens, state, ","); // consume ,
    }
    expect(tokens, state, ")"); // consume )

    // Handle body
    expect(tokens, state, "{"); // consume {
    const body: any[] = parseBody(tokens, state);
    expect(tokens, state, "}"); // consume }

    return {
        type: "FunctionDeclaration",
        returnType: returnType.lexeme,
        name: functionName.lexeme,
        parameters: params,
        body: body
    };
}

function parseVariableDeclaration(tokens: Token[], state: {current: number}): ASTNode {
    const type = consume(tokens, state);
    if(!isType(type.lexeme)) throw new Error(`Expected a valid variable type, found '${type.lexeme}', at line ${type.line}, column ${type.column}`);
    const name = consume(tokens, state);
    if(name.type !== "identifier") throw new Error(`Expected a variable name, found '${name.lexeme}', at line ${name.line}, column ${name.column}`);
    expect(tokens, state, "="); // consume =
    const value = parseExpression(tokens, state);
    expect(tokens, state, ";"); // consume ;
    return {
        type: "VariableDeclaration",
        dataType: type.lexeme,
        name: name.lexeme,
        value: value
    };
}

function parseBody(tokens: Token[], state: {current: number}): ASTNode[] {
    let body: any[] = [];
    while(peek(tokens, state)?.lexeme !== "}") {
        body.push(parseStatement(tokens));
    }
    return body;
}

function parseExpression(tokens: Token[], state: {current: number}, minBP: number = 0): ASTNode {
    let token = consume(tokens, state);
    let left: any;

    // NUD section
    // Literals
    if(isType(token.type)) {
        left = {type: "Literal", dateType: token.type, name: token.lexeme};
    }
    // Identifiers and function calls
    else if(token.type === "identifier") {
        // function calls
        if(peek(tokens, state)?.lexeme === "(") {
            expect(tokens, state, "("); // consume (
            const args: any[] = [];
            while(peek(tokens, state)?.lexeme !== ")") {
                args.push(parseExpression(tokens, state))
                if(peek(tokens, state)?.lexeme === ",") expect(tokens, state, ","); // consume ,
            }
            expect(tokens, state, ")"); // consume )
            left = {
                type: "FunctionCall",
                name: token.lexeme,
                arguments: args
            };
        }
        // Reassignment
        else if(peek(tokens, state)?.lexeme === "=") {
            expect(tokens, state, "="); // consume =
            const value = parseExpression(tokens, state);
            left = {
                type: "AssignmentExpression",
                operator: "=",
                left: {type: "Identifier", name: token.lexeme},
                right: value
            };
        }
        // identifiers
        else{
            left = {type: "Identifier", name: token.lexeme};
        }
    }
    // Parentheses
    else if(token.lexeme === "(") {
        left = parseExpression(tokens, state); // parse inside parens
        expect(tokens, state, ")"); // consume )
    }
    // Prefix ++ / --
    else if(token.type === "operator" && (token.lexeme === "++" || token.lexeme === "--")) {
        const op = token.lexeme;
        const argument = parseExpression(tokens, state, BINDING_POWER[op][1]);
        left = {
            type: "UnaryExpression",
            operator: op,
            argument: argument,
            prefix: true
        };
    }
    // Unknown token
    else{
        throw new Error(`Unexpected token: ${token.lexeme}`);
    }

    // LED section
    // infix/postfix loop
    while(true) {
        const op = peek(tokens, state);
        if(!op || !(op.lexeme in BINDING_POWER)) break;

        // Postfix ++/--
        if(op.lexeme === "++" || op.lexeme === "--") {
            expect(tokens, state, op.lexeme); // consume operator
            left = {
                type: "UnaryExpression",
                operator: op.lexeme,
                argument: left,
                prefix: false
            };
            continue;
        }

        const [leftBP, rightBP] = BINDING_POWER[op.lexeme] || [0,0];
        if(leftBP < minBP) break;
        
        expect(tokens, state, op.lexeme); // consume operator
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
