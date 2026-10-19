/** Native flags derived from Defold 1.9.8's CreateVertexData corner lookup.
 * Defold applies H/V before its clockwise quarter turn. Editor D transposes
 * in Y-down space; in Y-up space it reflects across the other diagonal.
 * Thus D = rotate90 + V, D+H = rotate90, D+V = rotate90+H+V.
 * These are export flags (1=H, 2=V, 4=D), not packed cell bits.
 */
export function defoldOrientation(flags: number): { h_flip: number; v_flip: number; rotate90: number } {
  return flags & 4
    ? { h_flip: flags & 2 ? 1 : 0, v_flip: flags & 1 ? 0 : 1, rotate90: 1 }
    : { h_flip: flags & 1 ? 1 : 0, v_flip: flags & 2 ? 1 : 0, rotate90: 0 };
}
