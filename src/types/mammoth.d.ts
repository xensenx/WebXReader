/**
 * Type declarations for mammoth library.
 */
declare module 'mammoth' {
  export interface ConversionResult {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  }

  export interface RawTextResult {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  }

  export interface ConvertOptions {
    arrayBuffer?: ArrayBuffer;
    buffer?: Buffer | Uint8Array;
    path?: string;
    styleMap?: string | string[];
    includeDefaultStyleMap?: boolean;
  }

  export function convertToHtml(input: ConvertOptions, options?: unknown): Promise<ConversionResult>;
  export function extractRawText(input: ConvertOptions): Promise<RawTextResult>;
}
