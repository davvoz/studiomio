/** A primitive that says what it measures or is. Unlike an Id, plain values are accepted as they
 *  are; a value with another tag isn't (the compiler stops beats where seconds are expected).
 *  The tag exists only for the compiler, and arithmetic gives back a plain value. */
export type Tagged<T, K extends string> = T & { readonly __tag?: K };
