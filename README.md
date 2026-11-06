# Media Proxy for Nijimiss

[MisskeyIO/media-proxy](https://github.com/MisskeyIO/media-proxy) をベースに、[TeamNijimiss/misskey](https://github.com/TeamNijimiss/misskey/tree/nijimiss) の内部メディアプロキシへ挙動を揃えた外部プロキシです。画像を取得・加工し、Misskey本体とは別のサーバーから配信します。Summalyは別サービスとして配置してください。

## 対応基準

2026年11月6日時点の次のコミットを基準としています。以後のNijimissへの追従は差分を確認して行います。

- ベース: MisskeyIO/media-proxy [`a09c469`](https://github.com/MisskeyIO/media-proxy/commit/a09c469186f7806a28d8843e22cbe719a76c2557)
- 互換対象: TeamNijimiss/misskey `nijimiss`、`2025.4.1-nijimiss.7`、[`13fa15e`](https://github.com/TeamNijimiss/misskey/commit/13fa15e96a8a49f4206f81f4d81bdfc3ea2e9d31)
- 比較対象: `FileServerService.proxyHandler`、`ImageProcessingService`、画像MIME一覧、`correctFilename`。
- Sharp `0.34.5`、BMP reader `1.3.0`、Fastify `5.8.2`、file-type `21.3.3` は互換対象と同じ版です。

## URLと変換

ベースURLが `https://media.example.net` の場合:

```text
https://media.example.net/avatar/example.org%2Favatar.png?avatar=1
https://media.example.net/image/example.org%2Fimage.jpg
https://media.example.net/preview/example.org%2Fimage.jpg?preview=1
https://media.example.net/avatar.webp?url=https%3A%2F%2Fexample.org%2Favatar.png&avatar=1
```

`/:type/:url` と `/:url` を受け付けます。元URLを一度だけURLエンコードしてください。`https://` は省略可能です。`http://` は省略せずにエンコードしてください。空でない `url` クエリは、パスの元URLより優先します。

パス名自体は変換方式を選択しません。クエリの**存在**で処理を決めるため、`avatar=0` や `static=` も有効です。優先順位は `emoji/avatar` → `static` → `preview` → `badge` → SVG変換 → 無変換です。

| クエリ | 応答 |
| --- | --- |
| `avatar` | 高さ320px以下のWebP。縦横比を保持し、拡大しない。アニメーションを保持 |
| `emoji` | 高さ128px以下のWebP。縦横比を保持し、拡大しない |
| 上記と `static` | 上記サイズで最初のフレームのみをWebP化 |
| `static` 単独 | 498×422px内の静止WebP。拡大せず、EXIFの向きを適用 |
| `preview` | 200×200px内の静止WebP。拡大せず、EXIFの向きを適用 |
| `badge` | 96×96pxの通知用PNG。低エントロピー画像は404 |
| 指定なしのSVG | 2048×2048px内の静止WebP |
| その他の指定なし | 許可された画像のみ、そのまま配信。音声・動画などは403 |
| `fallback` | 捕捉した取得・変換エラーに対して代替PNGを返す |

JPEG、TIFF、PNG、GIF、APNG、WebP、AVIF、SVG、BMP、ICOを扱います。APNGは `avatar` / `emoji` 指定時、`static` がなければ元データのまま返します。アニメーションWebPへの変換は無限ループに統一します。

成功時の `Cache-Control` は `max-age=31536000, immutable`、エラーと代替画像は `max-age=300` です。ファイル名は元のContent-DispositionまたはURL末尾を使い、最終形式に対して一度だけ補正します。エラー本文は本体同様に空とし、詳細はサーバーログへ出力します。User-Agentがない要求は400、`Misskey/` を含む要求は再帰プロキシとして403になります。

## 本体に残す処理と互換性の範囲

- 本体のDB・ローカルファイルへの直接アクセス、`/files/` の配信、動画サムネイル生成、外部プロキシへのリダイレクトは移植対象外です。
- 本体の `/files/` のURLはHTTP経由で取得します。DB上の欠損を表す特別な404画像や204、DB由来のRange処理まで同一にはなりません。
- `origin=1` は本体側で処理させる指定です。本体はこれがある要求を外部へ転送しません。このサービスに直接付けても本体へ送り直しません。
- 非画像は配信しないため、ffprobeによる音声・動画の細分類は持ち込みません。
- 配信はストリーム方式です。応答開始後のデコードエラーでは、ステータスや代替画像へ切り替えられない場合があります。
- 不正な複数の `url` クエリは400で拒否します。
- 本体と同じくURLパラメーター上限は1024です。変更する場合は `server.mjs` と前段の制限を合わせてください。
- 本番ではIO版のプライベートアドレス拒否を保持します。フォワードプロキシ利用時は、そのプロキシ側のアクセス制御も必要です。

出力仕様の互換を目標とし、異なるOS・libvips環境を含むバイト単位での一致は保証しません。変更範囲は [SPECIFICATION.md](./SPECIFICATION.md) を参照してください。

## 起動

Node.js 22と、package.jsonに指定されたpnpm 10.28.0を使います。

```sh
cp config.example.js config.js
pnpm install --frozen-lockfile
pnpm build
NODE_ENV=production pnpm start
```

初期ポートは3000です。`PORT` と `FASTIFY_LOG_LEVEL` で変更できます。メモリアロケータはDockerfileと同じmimalloc、または環境に合わせてjemallocを使用できます。前段のNginxなどでHTTPSとキャッシュを提供してください。

Docker Composeでローカルビルドする場合:

```sh
cp config.example.js config.js
docker compose up -d --build
```

`compose.yaml` は127.0.0.1:3000だけを公開します。Nginxをホスト上に置く構成向けです。設定ファイルは読み取り専用で `/app/config.js` に渡します。

Misskey本体の設定例:

```yaml
mediaProxy: https://media.example.net
```

前段が `/proxy/` を付ける場合は、上流に渡す際にそのプレフィックスを取り除きます。URLパス内の `%2F` や元URLのクエリを壊さずに転送してください。

## 検証

```sh
pnpm test
```

テストはローカルのHTTPサーバーから生成した画像を実際に取得し、Sharpで変換します。各画像形式、透過、GIF/WebPのアニメーション、APNG、変換優先順位、EXIF、TIFF、ファイル名、HTTPエラー、fallback、User-Agent、プライベートアドレス制限を検証します。外部サイトや本体のDBへの接続は不要です。

`built/` は上流に合わせて追跡しています。ソース変更後はビルド結果も更新してください。CIはNode.js 22でテストし、追跡済みのビルド結果がソースと一致することを確認します。TeamNijimiss/media-proxyのmainへのpushでは、検証後にamd64のコンテナをGHCRへ発行します。

## ライセンス

AGPL-3.0-only。[LICENSE](./LICENSE)を参照してください。MisskeyIO版と、その上流であるmisskey-dev/media-proxyを基にし、AGPL-3.0-onlyのNijimissコードを取り込んでいます。
