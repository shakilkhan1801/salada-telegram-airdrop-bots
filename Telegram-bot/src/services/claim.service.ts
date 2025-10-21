import { ethers } from 'ethers';

export interface ClaimContext {
  to?: string;
  account?: string;
  amountWei?: any;
  index?: number;
  proof?: string[];
  nonce?: any;
  signature?: string;
}

export class ClaimService {
  static buildCalldata(functionSignature: string, argsTemplate: string, ctx: ClaimContext): string {
    if (!functionSignature || !functionSignature.trim().startsWith('function ')) {
      throw new Error('CLAIM_FUNCTION_SIGNATURE must start with "function "');
    }

    const fnName = this.extractFunctionName(functionSignature);
    const iface = new ethers.utils.Interface([functionSignature]);

    const placeholders = (argsTemplate || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const values = placeholders.map((name) => this.resolveArg(name, ctx));

    return iface.encodeFunctionData(fnName, values);
  }

  private static extractFunctionName(signature: string): string {
    const match = signature.match(/function\s+([^\(\s]+)/);
    if (!match) return 'claim';
    return match[1];
  }

  private static resolveArg(name: string, ctx: ClaimContext): any {
    switch (name) {
      case 'to':
        if (!ctx.to && !ctx.account) throw new Error('Claim arg "to" required but not provided');
        return ctx.to || ctx.account;
      case 'account':
        if (!ctx.account && !ctx.to) throw new Error('Claim arg "account" required but not provided');
        return ctx.account || ctx.to;
      case 'amount':
        if (ctx.amountWei === undefined || ctx.amountWei === null) throw new Error('Claim arg "amount" required but not provided');
        return ctx.amountWei;
      case 'index':
        if (ctx.index === undefined || ctx.index === null) throw new Error('Claim arg "index" required but not provided');
        return ctx.index;
      case 'proof':
        if (!ctx.proof) throw new Error('Claim arg "proof" required but not provided');
        return ctx.proof;
      case 'nonce':
        if (ctx.nonce === undefined || ctx.nonce === null) throw new Error('Claim arg "nonce" required but not provided');
        return ctx.nonce;
      case 'signature':
        if (!ctx.signature) throw new Error('Claim arg "signature" required but not provided');
        return ctx.signature;
      default:
        throw new Error(`Unknown claim arg placeholder: ${name}`);
    }
  }
}
