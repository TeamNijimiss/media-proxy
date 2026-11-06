# Nijimiss互換差分

比較基準はNijimiss `13fa15e96a8a49f4206f81f4d81bdfc3ea2e9d31`、ベースはMisskeyIO/media-proxy `a09c469186f7806a28d8843e22cbe719a76c2557`。URLと起動方法、互換対象外の処理は[README](./README.md)を参照。

| 対象 | IO版からの変更 |
| --- | --- |
| 元URL | 空でない `url` クエリ → パスの順にする。単一セグメントも元URLとして扱う |
| 入力形式 | NijimissのBMP/ICOを含む変換MIME一覧と同じ内容にし、TIFFを追加 |
| MIME検出 | 判定段階の許可形式フィルタを外し、配信・変換段階で許可判定 |
| 無変換 | `image/*` かつブラウザセーフな形式だけ配信。音声・動画などは403 |
| WebP | Nijimissと同じ `loop: 0` を明示。他の既存パラメーターも維持 |
| User-Agent | 未指定を400、大小文字を問わず `Misskey/` を含む要求を403 |
| エラー | 302・4xxは元のステータス、それ以外は500。本文は空 |
| fallback | 成功扱いの代替PNG。静的ファイル送信側の自動上書きを止め、指定の300秒キャッシュを保持 |
| ファイル名 | NijimissのcorrectFilenameを移植し、最終形式に一度だけ適用 |
| ダウンロード | Nijimissと同じくHTTP/2を無効化。サイズ上限・タイムアウトは維持 |
| 依存バージョン | Sharp、BMP reader、Fastify、file-typeを基準と同じ版にする |

本体だけが持つDB・内部ストレージ情報は再現しません。本体側の私設ネットワーク例外も自動で持ち込まず、外部プロキシ自身の明示設定を使用します。

上流追従時は次を比較し、HTTPと画像のテストを更新してください。

- `packages/backend/src/server/FileServerService.ts` のproxyHandlerとerrorHandler
- `packages/backend/src/core/ImageProcessingService.ts`
- `packages/backend/src/misc/is-mime-image.ts`
- `packages/backend/src/misc/correct-filename.ts`
- `packages/backend/src/core/FileInfoService.ts` のdetectType
- `packages/backend/src/core/DownloadService.ts`
- `pnpm-workspace.yaml` の画像・HTTP関連のバージョン
