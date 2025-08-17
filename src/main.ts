import { tokenizer } from "./tokenizer"
import { parse } from "./parser";
import { analyze } from "./semanticAnalysis";
import { generateIR } from "./IR";

const tokens = tokenizer("test.hy");
const ast = parse(tokens);

console.dir(tokens, {maxArrayLength: null});
console.dir(ast, {depth: null, colors: true});

if(analyze(ast)) {
    console.log("Semantic analysis passed.");
}else{
    console.error("Semantic analysis failed.");
}

const ir = generateIR(ast);

console.dir(ir, {maxArrayLength: null, depth: null, colors: true});
