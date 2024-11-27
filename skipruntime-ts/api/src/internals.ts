const opaque: unique symbol = Symbol.for("Skip.opaque");
export const sk_frozen: unique symbol = Symbol.for("Skip.frozen");

export type Opaque<Value, Tag> = Value & { readonly [opaque]: Tag };
export type int = number;
export type Nullable<T> = T | null;

export interface Constant {
  readonly [sk_frozen]: true;
}

export abstract class Frozen implements Constant {
  // tsc misses that Object.defineProperty in the constructor inits this
  readonly [sk_frozen]!: true;

  constructor() {
    this.freeze();
  }

  protected abstract freeze(): void;
}
