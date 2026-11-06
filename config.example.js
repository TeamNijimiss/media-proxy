import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default {
    userAgent: `NijimissMediaProxy/${version}`,
    // 本体やストレージが私設ネットワークにある場合だけ、必要なCIDRを明示する。
    allowedPrivateNetworks: [],
    maxSize: 262144000,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    // proxy: 'http://127.0.0.1:3128',
};
