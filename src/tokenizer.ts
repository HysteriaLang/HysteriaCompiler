import fs from "fs";

/**
 * Represents a lexical token with its value, type, and position information
 */
export interface Token {
    lexeme: string;    // The actual text of the token
    type: string;      // The token type (keyword, identifier, operator, etc.)
    line: number;      // Line number where the token appears
    column: number;    // Column number where the token starts
}

// Global tokenizer state
let tokens: Token[] = [];          // Array to store all generated tokens
let charArr: string[] = [];        // Buffer for building multi-character tokens
let currentToken: string;          // Current character being processed
let line: number = 1;              // Current line number in source
let column: number = 1;            // Current column number in source
let startOfToken: number = 1;      // Column where current token started
let i = 0;                         // Index in character array

/**
 * Tokenizes source code from a file into an array of tokens
 * @param pathToFile Path to the source code file to tokenize
 * @returns Array of tokens representing the lexical structure of the source code
 */
export function tokenizer( pathToFile: string ): Token[] {
    // Read file and convert to character array, normalizing line endings
    let source: string = fs.readFileSync(pathToFile).toLocaleString();
    let arr: string[] = source.replace(/\r/g, "").split("");

    // Pre-process: combine multi-character operators into single tokens
    for(let i = 0; i < arr.length; i++) {
        switch(arr[i]) {
            case "=":
                // Handle compound assignment operators: ==, !=, <=, >=, +=, -=, *=, /=
                switch(arr[i + 1]) {
                    case "=":
                    case "!":
                    case "<":
                    case ">":
                    case "+":
                    case "-":
                    case "*":
                    case "/":
                        arr[i] += arr[i + 1];
                        arr.splice(i + 1, 1);
                    break;
                }
            break;
            case "&":
            case "|":
            case "+":
            case "-":
                // Handle logical operators (&&, ||) and increment/decrement (++, --)
                if(arr[i + 1] === arr[i]) {
                    arr[i] += arr[i + 1];
                    arr.splice(i + 1, 1);
                }
            break;
        }
    }

    // Main tokenization loop - process each character
    while(i < arr.length) {
        currentToken = arr[i];

        if(isWhiteSpace(currentToken)) {
            finalizeToken();
        }
        else if(isDigit(currentToken)) {
            startOrContinue();
        }
        else if(isLetter(currentToken) || currentToken == "_") {
            startOrContinue();
        }
        else if(isOperator(currentToken)) {
            finalizeToken();
            addToken(currentToken, "operator", line, column);
        }
        else if(isParenthesis(currentToken)) {
            finalizeToken();
            addToken(currentToken, "parenthesis", line, column);
        }
        else if(isPunctuation(currentToken)) {
            finalizeToken();
            addToken(currentToken, "punctuation", line, column);
        }
        else if(isBrackets(currentToken)) {
            finalizeToken();
            addToken(currentToken, "brackets", line, column);
        }
        else if(currentToken === "\"") {
            getString(column, arr);
        }

        updateLineAndColumn();
        i++;
    }
    
    return tokens;
}

// Character classification functions

/**
 * Checks if a character is whitespace (space, tab, newline, etc.)
 */
function isWhiteSpace(char: string): boolean {
    return /\s/.test(char);
}

/**
 * Checks if a character is a numeric digit (0-9)
 */
function isDigit(num: string): boolean {
    return /^\d$/.test(num);
}

/**
 * Checks if a character is an alphabetic letter (a-z, A-Z)
 */
function isLetter(char: string): boolean {
    return /^[a-zA-Z]$/.test(char);
}

/**
 * Checks if a symbol is a valid operator in the language
 */
function isOperator(symbol: string): boolean {
    return /^(==|!=|<=|>=|\+=|-=|\*=|\/=|%=|&&|\|\||%|\+|-|\*|\/|=|<|>|\+\+|--|!|\^)$/.test(symbol);
}

/**
 * Checks if a symbol is punctuation (semicolon, comma)
 */
function isPunctuation(symbol: string): boolean {
    return /^(;|,)$/.test(symbol);
}

/**
 * Checks if a symbol is a parenthesis
 */
function isParenthesis(symbol: string): boolean {
    return /^[()]$/.test(symbol);
}

/**
 * Checks if a symbol is a brace/bracket
 */
function isBrackets(symbol: string): boolean {
    return /^[{}]$/.test(symbol);
}

// Position tracking and token building functions

/**
 * Updates line and column counters based on current character
 * Advances to next line for statement terminators and block boundaries
 */
function updateLineAndColumn(): void {
    if(currentToken == ";" || currentToken == "{" || currentToken == "}") {
        line++;
        column = 1;
        return;
    }
    column++;
}

/**
 * Either starts a new multi-character token or continues building current one
 * Used for identifiers and numeric literals
 */
function startOrContinue(): void {
    if(charArr.length == 0) startOfToken = column;
    charArr.push(currentToken);
}

/**
 * Processes a string literal, consuming characters until closing quote
 * @param column Starting column of the string
 * @param array Character array being processed
 */
function getString(column: number, array: string[]): void {
    let value: string = "\"";
    let startColumn: number = column;
    i++;
    while(i < array.length && array[i] !== "\"") {
        value += array[i];
        i++;
    }
    value += "\"";
    addToken(value, "string", line, startColumn);
}

/**
 * Finalizes and categorizes a multi-character token built in charArr
 * Handles special case for "else if" keyword combination
 * Categorizes tokens as keywords, types, booleans, identifiers, or integers
 */
function finalizeToken(): void {
    let token: string = charArr.join("");
    
    // Special handling for "else if" compound keyword
    if(tokens[tokens.length - 1]?.lexeme === "else" && token === "if") {
        tokens[tokens.length - 1].lexeme = "else if";
        charArr = [];
        return;
    }
    
    // Categorize the token based on its content
    if(/^(function|return|if|else|for|while|break|continue)$/.test(token)) {
        addToken(token, "keyword", line, startOfToken);
    }else if(/^(int|string|boolean|float|char|void|null)$/.test(token)) {
        addToken(token, "type", line, startOfToken);
    }else if(/^(true|false)$/.test(token)) {
        addToken(token, "boolean", line, startOfToken);
    }else if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
        addToken(token, "identifier", line, startOfToken);
    }else if(/^-?\d+$/.test(token)) {
        addToken(token, "int", line, startOfToken);
    }
    charArr = [];
}

/**
 * Creates and adds a new token to the tokens array
 * @param lexeme The text content of the token
 * @param type The category/type of the token
 * @param line Line number where token appears
 * @param column Column number where token starts
 */
function addToken(lexeme: string, type: string, line: number, column: number): void {
    tokens.push({
        lexeme: lexeme,
        type: type,
        line: line,
        column: column
    });
}
