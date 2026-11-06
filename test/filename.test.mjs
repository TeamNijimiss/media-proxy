import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctFilename } from '../built/correct-filename.js';

test('Nijimiss filename rules preserve matching extensions and known aliases', () => {
    for (const [name, ext] of [['photo.PNG', 'png'], ['photo.jpeg', 'jpg'], ['photo.TIFF', 'tif'], ['library.dll', 'exe'], ['archive.tar', 'gz'], ['file.custom', null]]) {
        assert.equal(correctFilename(name, ext), name);
    }
    assert.equal(correctFilename('photo', 'webp'), 'photo.webp');
    assert.equal(correctFilename('photo.jpg', '.webp'), 'photo.jpg.webp');
    assert.equal(correctFilename('file', null), 'file.unknown');
});
