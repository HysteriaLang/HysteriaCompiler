/**
 * Represents a lexical token with its value, type, and position information
 */
export interface Token {
    lexeme: string;    // The actual text of the token
    type: string;      // The token type (keyword, identifier, operator, etc.)
    line: number;      // Line number where the token appears
    column: number;    // Column number where the token starts
}

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
export interface IRNode {
  op?: string;
  [key: string]: any;
}