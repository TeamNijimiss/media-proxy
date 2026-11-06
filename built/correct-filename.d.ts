/**
 * 与えられた拡張子とファイル名が一致しているかどうかを確認し、
 * 一致していない場合は拡張子を付与して返す
 *
 * extはfile-typeのextを想定
 */
export declare function correctFilename(filename: string, ext: string | null): string;
