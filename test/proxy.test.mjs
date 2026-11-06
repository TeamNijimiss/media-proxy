import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { parse as parseDisposition } from 'content-disposition';
import Fastify from 'fastify';
import sharp from 'sharp';
import mediaProxy from '../built/index.js';
import { createFixtures } from './fixtures.mjs';

let app, origin, base, fixtures;
const previousNodeEnv = process.env.NODE_ENV;
const headers = { 'user-agent': 'NijimissMediaProxyTest/1.0' };

before(async () => {
    process.env.NODE_ENV = 'production';
    fixtures = await createFixtures();
    origin = createServer((request, response) => {
        const fixture = fixtures.get(new URL(request.url, 'http://localhost').pathname);
        if (!fixture) return response.writeHead(404).end();
        // Deliberately lie about the type: the proxy must inspect the actual bytes.
        response.writeHead(fixture.status ?? 200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fixture.body.length,
            ...(fixture.filename ? { 'Content-Disposition': `inline; filename="${fixture.filename}"` } : {}),
        });
        response.end(fixture.body);
    });
    origin.listen(0, '127.0.0.1');
    await once(origin, 'listening');
    base = `http://127.0.0.1:${origin.address().port}`;
    app = Fastify({ routerOptions: { maxParamLength: 1024 } });
    app.register(mediaProxy, { allowedPrivateNetworks: ['127.0.0.0/8'], proxy: undefined });
    await app.ready();
});

after(async () => {
    await app?.close();
    if (origin?.listening) {
        origin.closeAllConnections();
        await new Promise((resolve, reject) => origin.close((err) => err ? reject(err) : resolve()));
    }
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
});

function request(path, query = {}, type = 'image', extra = {}) {
    const params = new URLSearchParams(query);
    return app.inject({ method: 'GET', url: `/${type}/${encodeURIComponent(base + path)}?${params}`, headers, ...extra });
}

async function webp(response, width, height) {
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['content-type'], 'image/webp');
    const metadata = await sharp(response.rawPayload).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    return metadata;
}

test('untransformed images preserve bytes, MIME, cache and inline disposition', async () => {
    const result = await request('/image.png');
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.rawPayload, fixtures.get('/image.png').body);
    assert.equal(result.headers['content-type'], 'image/png');
    assert.equal(result.headers['cache-control'], 'max-age=31536000, immutable');
    assert.equal(parseDisposition(result.headers['content-disposition']).parameters.filename, 'image.png');
    assert.match(result.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(result.headers['access-control-allow-origin'], '*');
});

for (const extension of ['jpg', 'png', 'tiff', 'webp', 'avif', 'svg', 'bmp', 'ico']) {
    test(`avatar converts ${extension} to WebP without upscaling`, async () => {
        const expected = extension === 'svg' ? [640, 320] : extension === 'bmp' ? [2, 2] : extension === 'ico' ? [40, 30] : [427, 320];
        await webp(await request(`/image.${extension}`, { avatar: '1' }, 'avatar'), ...expected);
    });
}

test('path labels do not select a transformation; query presence does', async () => {
    const unchanged = await request('/image.png', {}, 'avatar');
    assert.deepEqual(unchanged.rawPayload, fixtures.get('/image.png').body);
    await webp(await request('/image.png', { avatar: '0' }), 427, 320);
    await webp(await request('/image.png', { avatar: '' }), 427, 320);
});

test('avatar preserves transparency and does not enlarge small images', async () => {
    const metadata = await webp(await request('/small.png', { avatar: '1' }), 40, 30);
    assert.equal(metadata.hasAlpha, true);
});

test('emoji takes precedence over avatar and static keeps that size', async () => {
    await webp(await request('/image.png', { emoji: '1', avatar: '1', static: '1' }), 171, 128);
});

test('static, preview and SVG use their Nijimiss bounding boxes', async () => {
    await webp(await request('/image.png', { static: '1', preview: '1' }), 498, 374);
    await webp(await request('/image.png', { preview: '1' }), 200, 150);
    await webp(await request('/image.svg'), 2048, 1024);
});

test('static output resolves EXIF orientation and strips metadata', async () => {
    const metadata = await webp(await request('/oriented.jpg', { static: '1' }), 317, 422);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
});

for (const extension of ['gif', 'webp']) {
    test(`animated ${extension} stays animated for avatars and becomes static on request`, async () => {
        const animated = await request(`/animated.${extension}`, { avatar: '1' });
        assert.equal(animated.statusCode, 200);
        const metadata = await sharp(animated.rawPayload, { animated: true }).metadata();
        assert.equal(metadata.pages, 2);
        assert.equal(metadata.loop, 0);
        assert.deepEqual(metadata.delay, [100, 200]);
        const still = await request(`/animated.${extension}`, { avatar: '1', static: '1' });
        const staticMetadata = await sharp(still.rawPayload).metadata();
        assert.equal(staticMetadata.pages ?? 1, 1);
    });
}

test('APNG is passed through for avatars and converted only with static', async () => {
    const animated = await request('/animated.png', { avatar: '1' });
    assert.equal(animated.statusCode, 200);
    assert.equal(animated.headers['content-type'], 'image/apng');
    assert.deepEqual(animated.rawPayload, fixtures.get('/animated.png').body);
    await webp(await request('/animated.png', { avatar: '1', static: '1' }), 2, 1);
});

test('badge returns a 96x96 PNG and rejects images with too little entropy', async () => {
    const result = await request('/badge.png', { badge: '1' });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['content-type'], 'image/png');
    const metadata = await sharp(result.rawPayload).metadata();
    assert.equal(metadata.width, 96);
    assert.equal(metadata.height, 96);
    assert.equal(metadata.hasAlpha, true);
    assert.equal((await request('/small.png', { badge: '1' })).statusCode, 404);
});

for (const path of ['/audio.wav', '/page.html', '/empty']) {
    test(`non-image ${path} is rejected with 403, or 404 when conversion is requested`, async () => {
        const raw = await request(path);
        assert.equal(raw.statusCode, 403);
        assert.equal(raw.body, '');
        const converted = await request(path, { avatar: '1' });
        assert.equal(converted.statusCode, 404);
        assert.equal(converted.body, '');
        assert.equal(converted.headers['cache-control'], 'max-age=300');
    });
}

test('query URLs override path URLs, and old-style and redirect URLs work', async () => {
    await webp(await request('/missing.png', { url: `${base}/small.png`, avatar: '1' }), 40, 30);
    const legacy = await app.inject({ url: `/avatar.webp?${new URLSearchParams({ url: `${base}/small.png`, avatar: '1' })}`, headers });
    await webp(legacy, 40, 30);
    const singlePath = await app.inject({ url: `/${encodeURIComponent(base + '/small.png')}`, headers });
    assert.deepEqual(singlePath.rawPayload, fixtures.get('/small.png').body);
    await webp(await request('/small.png', { avatar: '1' }, 'redirect'), 40, 30);
});

test('empty query URLs fall back to the path and repeated URLs return 400', async () => {
    await webp(await request('/small.png', { url: '', avatar: '1' }), 40, 30);
    const invalid = await app.inject({ url: `/image/path?url=a&url=b`, headers });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body, '');
});

test('missing User-Agent and recursive Misskey proxy requests are rejected', async () => {
    assert.equal((await request('/small.png', {}, 'image', { headers: { 'user-agent': undefined } })).statusCode, 400);
    assert.equal((await request('/small.png', {}, 'image', { headers: { 'user-agent': 'mIsSkEy/2025.4.1' } })).statusCode, 403);
});

test('upstream errors have empty bodies; fallback returns the actual dummy image', async () => {
    for (const [path, status] of [['/missing.png', 404], ['/failed.png', 500]]) {
        const failed = await request(path);
        assert.equal(failed.statusCode, status);
        assert.equal(failed.body, '');
        assert.equal(failed.headers['cache-control'], 'max-age=300');
        const fallback = await request(path, { fallback: '1' });
        assert.equal(fallback.statusCode, 200);
        assert.equal(fallback.headers['cache-control'], 'max-age=300');
        assert.equal(fallback.headers['content-type'], 'image/png');
        assert.deepEqual(fallback.rawPayload, await readFile(new URL('../assets/dummy.png', import.meta.url)));
    }
});

test('file names are corrected once, using the final image format', async () => {
    const raw = await request('/named.jpg');
    assert.equal(parseDisposition(raw.headers['content-disposition']).parameters.filename, 'photo.JPG.png');
    const converted = await request('/named.jpg', { avatar: '1' });
    assert.equal(parseDisposition(converted.headers['content-disposition']).parameters.filename, 'photo.JPG.webp');
});

test('production private-address restrictions remain enabled by default', async () => {
    const restricted = Fastify();
    restricted.register(mediaProxy, { proxy: undefined });
    try {
        const result = await restricted.inject({ url: `/image/${encodeURIComponent(base + '/small.png')}`, headers });
        assert.equal(result.statusCode, 500);
        assert.equal(result.body, '');
    } finally {
        await restricted.close();
    }
});
