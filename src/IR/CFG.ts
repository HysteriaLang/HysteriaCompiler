import { IRNode } from "../types";

// convert the SSA into basic blocks that have ids (b0, b1, ...)
// it will have phis array, instructions array, terminators, successor, predicessor 

export function createCFG(IR: IRNode[]) {
    return IR;
}