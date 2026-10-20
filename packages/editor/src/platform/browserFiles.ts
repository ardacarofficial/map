import type { SaveFileFilter } from './types';
/** Browser development adapter; desktop always uses a native platform dialog. */
export function openBrowserFile(filter: SaveFileFilter): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = filter.extensions.map(ext => `.${ext}`).join(',');
    input.hidden = true; document.body.appendChild(input);
    input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0]; input.remove();
      if (!file) resolve(null);
      else void file.arrayBuffer().then(bytes => resolve({ name: file.name, bytes: new Uint8Array(bytes) }), reject);
    }, { once: true });
    input.click();
  });
}
