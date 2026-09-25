declare module "docnori-heif" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(data: ImageData, callback: (data: ImageData | null) => void): void;
    free(): void;
  }
  interface HeifDecoder {
    decoder: number;
    decode(buffer: ArrayBuffer): HeifImage[];
  }
  export default function build(): {
    HeifDecoder: new () => HeifDecoder;
    heif_context_free(context: number): void;
  };
}
