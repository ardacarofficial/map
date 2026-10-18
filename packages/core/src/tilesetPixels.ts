/** Raw RGBA pixels, supplied by callers; core never loads images. */
export interface RgbaImage { readonly width: number; readonly height: number; readonly data: Uint8Array | Uint8ClampedArray }
