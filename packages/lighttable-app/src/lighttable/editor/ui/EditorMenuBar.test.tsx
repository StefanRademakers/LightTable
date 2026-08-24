import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorMenuBar } from './EditorMenuBar';

describe('EditorMenuBar', () => {
  it('places Filter directly after Select in the top-level menu', () => {
    const markup = renderToStaticMarkup(<EditorMenuBar optionsFor={() => []} />);
    const selectIndex = markup.indexOf('>Select</button>');
    const filterIndex = markup.indexOf('>Filter</button>');
    const aiIndex = markup.indexOf('>AI</button>');
    expect(selectIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeGreaterThan(selectIndex);
    expect(aiIndex).toBeGreaterThan(filterIndex);
  });
});
