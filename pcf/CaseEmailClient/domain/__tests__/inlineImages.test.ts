// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { cidReferences, normaliseCid, resolveCidImages, toImageDataUrl } from '../inlineImages';
import { prepareBody } from '../bodyPipeline';

// The real reference from CAS-01130-T1M1W1's reply, and its attachment row's Content-ID.
const CID = '11ec390e-f033-481d-a21b-0b71002eeea8';
const LOGO = `<img alt="Company Logo" width="31" height="27" src="cid:${CID}">`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('inline images (cid:)', () => {
  it('normalises every spelling of a Content-ID', () => {
    expect(normaliseCid(`<${CID.toUpperCase()}>`)).toBe(CID);
    expect(normaliseCid('image001.png%4001DC0000.0000')).toBe('image001.png@01dc0000.0000');
  });

  it('finds the references in a body', () => {
    expect(cidReferences(`<p>x</p>${LOGO}<img src="https://a.example.invalid/x.png">`))
      .toEqual(new Set([CID]));
  });

  it('builds a data URL for raster images only — never SVG', () => {
    expect(toImageDataUrl('image/png', PNG)).toBe(`data:image/png;base64,${PNG}`);
    expect(toImageDataUrl('image/svg+xml', 'PHN2Zy8+')).toBeUndefined();
    expect(toImageDataUrl('text/html', 'PGgxPg==')).toBeUndefined();
    expect(toImageDataUrl('image/png', 'not base64 <script>')).toBeUndefined();
  });

  it('swaps the reference for the image and leaves unresolvable ones alone', () => {
    const out = resolveCidImages(`${LOGO}<img src="cid:missing@x">`, new Map([[CID, `data:image/png;base64,${PNG}`]]));
    expect(out).toContain(`src="data:image/png;base64,${PNG}"`);
    expect(out).toContain('src="cid:missing@x"');
  });

  it('survives the body pipeline — the sanitiser keeps our raster data URL', () => {
    const out = prepareBody(`<p>Kind regards</p>${LOGO}`, {
      inlineImages: new Map([[CID, `data:image/png;base64,${PNG}`]]),
    });
    expect(out.newHtml).toContain(`data:image/png;base64,${PNG}`);
    // A cid: image is part of the message, not a remote fetch: nothing to "show".
    expect(out.blockedImages).toBe(0);
  });
});
