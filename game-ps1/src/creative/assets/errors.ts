/**
 * AssetError: CreativeError carrying the logical key and the source chain of
 * the failed asset, so diagnostics can point back to what was requested and
 * where from (S03 G04).
 */
import { CreativeError } from '../core/errors.ts';

export class AssetError extends CreativeError {
  readonly key: string;
  readonly chain: readonly string[];

  constructor(code: string, key: string, message: string, chain: readonly string[] = [], cause?: unknown) {
    super(code, `${message} [asset ${chain.join(' <- ')}]`, cause !== undefined ? { cause } : undefined);
    this.name = 'AssetError';
    this.key = key;
    this.chain = chain;
  }
}
