import sharp from 'sharp';
import { deflateSync } from 'node:zlib';

function chunk(type, data) {
    const name = Buffer.from(type);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    name.copy(result, 4);
    data.copy(result, 8);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
}

function apng() {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2);
    const control = (sequence) => {
        const data = Buffer.alloc(26);
        data.writeUInt32BE(sequence, 0);
        data.writeUInt32BE(2, 4);
        data.writeUInt32BE(1, 8);
        data.writeUInt16BE(1, 20);
        data.writeUInt16BE(10, 22);
        return chunk('fcTL', data);
    };
    const frame = (color) => deflateSync(Buffer.from([0, ...color, ...color]));
    const second = Buffer.alloc(4);
    second.writeUInt32BE(2);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', actl),
        control(0), chunk('IDAT', frame([255, 0, 0, 255])), control(1),
        chunk('fdAT', Buffer.concat([second, frame([0, 0, 255, 255])])), chunk('IEND', Buffer.alloc(0)),
    ]);
}

function bmp() {
    const data = Buffer.alloc(70);
    data.write('BM');
    data.writeUInt32LE(data.length, 2);
    data.writeUInt32LE(54, 10);
    data.writeUInt32LE(40, 14);
    data.writeInt32LE(2, 18);
    data.writeInt32LE(2, 22);
    data.writeUInt16LE(1, 26);
    data.writeUInt16LE(24, 28);
    data.writeUInt32LE(16, 34);
    Buffer.from([0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0]).copy(data, 54);
    return data;
}

export async function createFixtures() {
    const image = sharp({ create: { width: 800, height: 600, channels: 4, background: '#ff000080' } });
    const png = await image.clone().png().toBuffer();
    const small = await image.clone().resize(40, 30).png().toBuffer();
    const frames = Buffer.concat([Buffer.alloc(4 * 4 * 4, 0), Buffer.alloc(4 * 4 * 4, 255)]);
    const gif = await sharp(frames, { raw: { width: 4, height: 8, channels: 4, pageHeight: 4 } })
        .gif({ loop: 3, delay: [100, 200] }).toBuffer();
    const icoHeader = Buffer.alloc(22);
    icoHeader.writeUInt16LE(1, 2);
    icoHeader.writeUInt16LE(1, 4);
    icoHeader[6] = 40;
    icoHeader[7] = 30;
    icoHeader.writeUInt16LE(1, 10);
    icoHeader.writeUInt16LE(32, 12);
    icoHeader.writeUInt32LE(small.length, 14);
    icoHeader.writeUInt32LE(22, 18);
    const wav = Buffer.alloc(48);
    wav.write('RIFF');
    wav.writeUInt32LE(40, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(8000, 28);
    wav.writeUInt16LE(1, 32);
    wav.writeUInt16LE(8, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(4, 40);
    const gradient = Buffer.alloc(96 * 96 * 3);
    for (let i = 0; i < 96 * 96; i++) gradient.fill(Math.floor((i % 96) * 255 / 95), i * 3, i * 3 + 3);
    return new Map([
        ['/image.png', { body: png }], ['/small.png', { body: small }],
        ['/image.tiff', { body: await image.clone().tiff().toBuffer() }],
        ['/image.jpg', { body: await image.clone().flatten({ background: '#fff' }).jpeg().toBuffer() }],
        ['/image.webp', { body: await image.clone().webp().toBuffer() }],
        ['/image.avif', { body: await image.clone().avif({ effort: 0 }).toBuffer() }],
        ['/oriented.jpg', { body: await image.clone().jpeg().withMetadata({ orientation: 6 }).toBuffer() }],
        ['/animated.gif', { body: gif }], ['/animated.webp', { body: await sharp(gif, { animated: true }).webp().toBuffer() }],
        ['/animated.png', { body: apng() }], ['/image.bmp', { body: bmp() }],
        ['/image.ico', { body: Buffer.concat([icoHeader, small]) }],
        ['/image.svg', { body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="1500"><rect width="3000" height="1500" fill="red"/></svg>') }],
        ['/badge.png', { body: await sharp(gradient, { raw: { width: 96, height: 96, channels: 3 } }).png().toBuffer() }],
        ['/audio.wav', { body: wav }], ['/page.html', { body: Buffer.from('<html>not an image</html>') }],
        ['/empty', { body: Buffer.alloc(0) }],
        ['/named.jpg', { body: png, filename: 'photo.JPG' }],
        ['/missing.png', { body: Buffer.alloc(0), status: 404 }],
        ['/failed.png', { body: Buffer.alloc(0), status: 503 }],
    ]);
}
