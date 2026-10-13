/** Crea un elemento con proprietà e figli. */
export function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): T {
  const e = Object.assign(document.createElement(tag), props) as T;
  e.append(...children);
  return e;
}
