import { describe, expect, it } from 'vitest';
import {
  adjustCuesForTrim,
  findActiveCuesAtTime,
  parseSubtitleText,
  serializeToSrt,
  serializeToVtt,
} from '../engines/video/subtitleParser';

describe('SRT & WebVTT subtitle parser & serializer', () => {
  it('parses valid multi-line SRT cues and sorts chronologically', () => {
    const rawSrt = `2
00:00:04,500 --> 00:00:07,250
<b>Baris kedua</b> tetap terbaca

1
00:00:01,000 --> 00:00:03,500
Halo dunia!
Baris tambahan
`;
    const cues = parseSubtitleText(rawSrt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      startSec: 1,
      endSec: 3.5,
      text: 'Halo dunia!\nBaris tambahan',
    });
    expect(cues[1]).toMatchObject({
      startSec: 4.5,
      endSec: 7.25,
      text: 'Baris kedua tetap terbaca',
    });
  });

  it('parses WebVTT cues with short MM:SS.mmm timestamps and skips malformed blocks', () => {
    const rawVtt = `WEBVTT

NOTE ini komentar VTT

00:02.100 --> 00:05.900 align:center
Pembuka video HD

00:09.000 --> 00:06.000
Rentang waktu terbalik harus diabaikan
`;
    const cues = parseSubtitleText(rawVtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      startSec: 2.1,
      endSec: 5.9,
      text: 'Pembuka video HD',
    });

    expect(parseSubtitleText('bukan file subtitle')).toEqual([]);
  });

  it('shifts timestamps accurately when trimmed and serializes SRT/VTT cleanly', () => {
    const cues = [
      { id: '1', startSec: 0.5, endSec: 2.0, text: 'Awal' },
      { id: '2', startSec: 2.5, endSec: 5.5, text: 'Tengah' },
      { id: '3', startSec: 8.0, endSec: 10.0, text: 'Akhir terpotong' },
    ];
    const trimmed = adjustCuesForTrim(cues, 1.0, 6.0);
    expect(trimmed).toHaveLength(2);
    expect(trimmed[0]).toMatchObject({ startSec: 0, endSec: 1.0, text: 'Awal' });
    expect(trimmed[1]).toMatchObject({ startSec: 1.5, endSec: 4.5, text: 'Tengah' });

    const srt = serializeToSrt(cues, 1.0, 6.0);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000\nAwal');
    const vtt = serializeToVtt(cues, 1.0, 6.0);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.500 --> 00:00:04.500\nTengah');

    expect(findActiveCuesAtTime(cues, 3.0).map((c) => c.id)).toEqual(['2']);
  });
});
