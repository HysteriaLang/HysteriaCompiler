import fs from "fs";

export interface Token {
    lexeme: string;
    type: string;
    line: number;
    column: number;
}

let tokens: Token[] = [];
let charArr: string[] = [];
let currentToken: string;
let line: number = 1;
let column: number = 1;
let startOfToken: number = 1;
let i = 0;

/**
 * takes in the source code from a file and tokenizers everything in it
 * @param pathToFile string that leads to the file
 */
export function tokenizer( pathToFile: string ): Token[] {
    // to string, to character array
    let source: string = fs.readFileSync(pathToFile).toLocaleString();
    let arr: string[] = source.replace(/\r/g, "").split("");

    for(let i = 0; i < arr.length; i++) {
        switch(arr[i]) {
            case "=":
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
                if(arr[i + 1] === arr[i]) {
                    arr[i] += arr[i + 1];
                    arr.splice(i + 1, 1);
                }
            break;
        }
    }

    while(i < arr.length) {
        currentToken = arr[i];

        if(isWhiteSpace(currentToken)) {
            finalizeToken();
        }else if(isDigit(currentToken)) {
            startOrContinue();
        }else if(isLetter(currentToken) || currentToken == "_") {
            startOrContinue();
        }else if(isOperator(currentToken)) {
            finalizeToken();
            addToken(currentToken, "operator", line, column);
        }else if(isParenthesis(currentToken)) {
            finalizeToken();
            addToken(currentToken, "parenthesis", line, column);
        }else if(isPunctuation(currentToken)) {
            finalizeToken();
            addToken(currentToken, "punctuation", line, column);
        }else if(isBrackets(currentToken)) {
            finalizeToken();
            addToken(currentToken, "brackets", line, column);
        }else if(currentToken === "\"") {
            getString(column, arr);
        }

        updateLineAndColumn();
        i++;
    }
    
    return tokens;
}

function isWhiteSpace(char: string): boolean {
    return /\s/.test(char);
}
function isDigit(num: string): boolean {
    return /^\d$/.test(num);
}
function isLetter(char: string) {
    return /^[a-zA-Z]$/.test(char)
}
function isOperator(symbol: string): boolean {
    return /^(==|!=|<=|>=|\+=|-=|\*=|\/=|%=|&&|\|\||%|\+|-|\*|\/|=|<|>|\+\+|--|!|\^)$/.test(symbol)
}
function isPunctuation(symbol: string): boolean {
    return /^(;|,)$/.test(symbol);
}
function isParenthesis(symbol: string): boolean {
    return /^[()]$/.test(symbol);
}
function isBrackets(symbol: string): boolean {
    return /^[{}]$/.test(symbol);
}
function updateLineAndColumn(): void {
    if(currentToken == ";" || currentToken == "{" || currentToken == "}") {
        line++;
        column = 1;
        return;
    }
    column++;
}
function startOrContinue(): void {
    if(charArr.length == 0) startOfToken = column;
    charArr.push(currentToken);
}
function getString(column: number, array: string[]): void {
    let value: string = "\"";
    let startColumn: number = column;
    i++;
    while(i < array.length && array[i] !== "\"") {
        value += array[i];
        i++
    }
    value += "\"";
    addToken(value, "string", line, startColumn);
}
function finalizeToken(): void {
    let token: string = charArr.join("");
    if(tokens[tokens.length - 1]?.lexeme === "else" && token === "if") {
        tokens[tokens.length - 1].lexeme = "else if"; // special case for else if
        charArr = [];
        return;
    }
    if(/^(function|return|if|else|for|while)$/.test(token)) {
        addToken(token, "keyword", line, startOfToken);
    }else if(/^(int|string|boolean|float|char|void|null)$/.test(token)) {
        addToken(token, "type", line, startOfToken);
    }else if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
        addToken(token, "identifier", line, startOfToken);
    }else if(/^-?\d+$/.test(token)) {
        addToken(token, "int", line, startOfToken);
    }else if(/^(true|false)$/.test(token)) {
        addToken(token, "boolean", line, startOfToken);
    }
    charArr = [];
}
function addToken(lexeme: string, type: string, line: number, column: number) {
    tokens.push({
        lexeme: lexeme,
        type: type,
        line: line,
        column: column
    });
}
