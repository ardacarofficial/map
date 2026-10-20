import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ColorPalettes } from './ColorPalettes';
it('uses shared tooltip triggers for palette actions, without native titles', () => {
  const html = renderToStaticMarkup(<ColorPalettes />);
  expect(html).not.toContain(' title=');
  expect(html).toContain('data-base-ui-tooltip-trigger');
});
