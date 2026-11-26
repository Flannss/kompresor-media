import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canNativeShareFile,
  executeWhatsAppShareFlow,
  isLikelyMobileDevice,
} from '../features/export-share/shareHelper';

describe('WhatsApp share flow routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses desktop download + WhatsApp Web helper on non-mobile user agents even if navigator.canShare exists', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0'
    );
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true });

    expect(isLikelyMobileDevice()).toBe(false);
    const blob = new Blob(['test'], { type: 'image/jpeg' });
    expect(canNativeShareFile(blob, 'foto-kompresor.jpg', 'image/jpeg')).toBe(false);

    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    const outcome = await executeWhatsAppShareFlow({
      blob,
      objectUrl: 'blob:http://localhost/test',
      fileName: 'foto-kompresor.jpg',
      mimeType: 'image/jpeg',
    });
    expect(outcome).toBe('desktop-helper');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('detects mobile user agents for native Web Share file handoff', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0.0.0 Mobile'
    );
    expect(isLikelyMobileDevice()).toBe(true);
  });
});
