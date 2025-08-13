import { tokenizer } from "./tokenizer"
import { parse } from "./parser";
import { analyze } from "./semanticAnalysis";

let tokens = tokenizer("test.hy");
let ast = parse(tokens);

console.dir(tokens, {maxArrayLength: null});
console.dir(ast, {depth: null, colors: true});

if(analyze(ast)) {
    console.log("Semantic analysis passed.");
}else{
    console.error("Semantic analysis failed.");
}
