import { AST, IRNode } from '../types';
import { generateSSA } from "./SSA"
import { flattenAssignments } from './normalize';
import { createCFG } from './CFG';

export function generateIR(ast: AST): IRNode[] {
  let IR = generateSSA(ast.body);
  IR = flattenAssignments(IR);
  IR = createCFG(IR);
  return IR;
}