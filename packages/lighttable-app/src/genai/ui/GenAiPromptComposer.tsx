import { ButtonBase } from '../../ui/ButtonBase';
import React from 'react';
import type { GenAiAssetId, GenAiAssetMentionOption } from '@lighttable/genai-core';

export interface GenAiPromptComposerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly mentions: readonly GenAiAssetMentionOption[];
  readonly previews: Readonly<Record<string, string>>;
  readonly requestPreview: (assetId: GenAiAssetId) => void;
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const normalizeToken = (value: string): string => value.toLocaleLowerCase('en-US').replace(/^@/u, '');

const findMention = (token: string, options: readonly GenAiAssetMentionOption[]) => {
  const normalized = normalizeToken(token);
  return options.find(({ token: candidate, asset }) => (
    normalizeToken(candidate) === normalized || normalizeToken(asset.label) === normalized
  ));
};

export const renderPromptMarkup = (
  value: string,
  options: readonly GenAiAssetMentionOption[],
  previews: Readonly<Record<string, string>>
): string => value.split('\n').map((line) => {
  let cursor = 0;
  let output = '';
  for (const match of line.matchAll(/@[A-Za-z0-9_-]+/gu)) {
    const token = match[0];
    const index = match.index ?? 0;
    output += escapeHtml(line.slice(cursor, index));
    const option = findMention(token, options);
    if (option) {
      const preview = previews[option.asset.id];
      output += `<span class="genai-prompt-token" data-token="${escapeHtml(option.token)}" contenteditable="false">${preview ? `<img src="${escapeHtml(preview)}" alt="">` : ''}<strong>${escapeHtml(option.token)}</strong></span>`;
    } else output += escapeHtml(token);
    cursor = index + token.length;
  }
  return output + escapeHtml(line.slice(cursor));
}).join('<br>');

const serialize = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    if (element.tagName === 'BR') return '\n';
    if (element.dataset.token) return element.dataset.token;
  }
  return Array.from(node.childNodes).map(serialize).join('');
};

const selectionOffset = (root: HTMLElement): number | null => {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.endContainer, range.endOffset);
  return serialize(prefix.cloneContents()).length;
};

const pointAtOffset = (root: Node, target: number): { node: Node; offset: number } => {
  let remaining = Math.max(0, target);
  const visit = (node: Node): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      return null;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const amount = element.tagName === 'BR' ? 1 : element.dataset.token?.length;
      if (amount !== undefined) {
        const parent = node.parentNode;
        if (!parent) return null;
        const index = Array.from(parent.childNodes).indexOf(node as ChildNode);
        if (remaining <= amount) return { node: parent, offset: index + (remaining ? 1 : 0) };
        remaining -= amount;
        return null;
      }
    }
    for (const child of Array.from(node.childNodes)) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root) ?? { node: root, offset: root.childNodes.length };
};

const restoreCaret = (root: HTMLElement, offset: number): void => {
  const point = pointAtOffset(root, offset);
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const mentionSearch = (value: string, caret: number | null) => {
  if (caret === null) return null;
  const match = /(?:^|\s)(@[A-Za-z0-9_-]*)$/u.exec(value.slice(0, caret));
  return match ? { start: caret - match[1].length, query: match[1].slice(1) } : null;
};

export const GenAiPromptComposer = ({ value, onChange, mentions, previews, requestPreview }: GenAiPromptComposerProps) => {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const focused = React.useRef(false);
  const [caret, setCaret] = React.useState<number | null>(0);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const search = mentionSearch(value, caret);
  const suggestions = search ? mentions.filter(({ token, asset }) => {
    const query = search.query.toLocaleLowerCase('en-US');
    return token.toLocaleLowerCase('en-US').includes(query)
      || asset.label.toLocaleLowerCase('en-US').includes(query);
  }).slice(0, 10) : [];

  const applyMarkup = React.useCallback((nextValue: string, offset?: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = renderPromptMarkup(nextValue, mentions, previews);
    if (offset !== undefined) restoreCaret(editor, offset);
  }, [mentions, previews]);

  React.useLayoutEffect(() => {
    if (!focused.current) applyMarkup(value);
  }, [applyMarkup, value]);

  React.useEffect(() => {
    for (const option of suggestions) requestPreview(option.asset.id);
  }, [requestPreview, suggestions]);

  const readEditorValue = (): string | null => {
    const editor = editorRef.current;
    return editor ? serialize(editor).replaceAll('\u00a0', ' ') : null;
  };

  const syncEditingDom = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const offset = selectionOffset(editor);
    const next = readEditorValue();
    if (next === null) return;
    onChange(next);
    setCaret(offset);
    applyMarkup(next, offset ?? next.length);
  };

  const finishEditing = () => {
    focused.current = false;
    const next = readEditorValue();
    if (next !== null) onChange(next);
    setCaret(null);
  };

  const insertMention = (option: GenAiAssetMentionOption) => {
    if (!search) return;
    const end = caret ?? value.length;
    const next = `${value.slice(0, search.start)}${option.token} ${value.slice(end)}`;
    const nextCaret = search.start + option.token.length + 1;
    onChange(next);
    setCaret(nextCaret);
    requestPreview(option.asset.id);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      applyMarkup(next, nextCaret);
    });
  };

  return (
    <section className="genai-prompt-composer">
      <div className="genai-prompt-composer__heading">
        <label htmlFor="lighttable-genai-prompt">Prompt</label>
        <span><strong>single</strong><i />set</span>
      </div>
      <div className="genai-prompt-composer__editor">
        <div ref={editorRef} id="lighttable-genai-prompt" className="genai-prompt-composer__input"
          contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
          data-placeholder="Describe the image. Type @ to reference a project asset."
          onFocus={() => { focused.current = true; setCaret(selectionOffset(editorRef.current!)); }}
          onBlur={finishEditing}
          onInput={syncEditingDom}
          onClick={() => setCaret(editorRef.current ? selectionOffset(editorRef.current) : null)}
          onKeyUp={() => setCaret(editorRef.current ? selectionOffset(editorRef.current) : null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setCaret(null);
              event.currentTarget.blur();
              return;
            }
            if (event.key === 'Backspace' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              const editor = editorRef.current;
              const selection = window.getSelection();
              const offset = editor ? selectionOffset(editor) : null;
              if (editor && selection?.isCollapsed && offset !== null) {
                const token = /@[A-Za-z0-9_-]+$/u.exec(value.slice(0, offset))?.[0];
                if (token && findMention(token, mentions)) {
                  event.preventDefault();
                  const next = `${value.slice(0, offset - 1)}${value.slice(offset)}`;
                  const nextCaret = offset - 1;
                  onChange(next);
                  setCaret(nextCaret);
                  applyMarkup(next, nextCaret);
                  return;
                }
              }
            }
            if (!suggestions.length) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => (value + 1) % suggestions.length); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => (value - 1 + suggestions.length) % suggestions.length); }
            else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insertMention(suggestions[activeIndex] ?? suggestions[0]!); }
          }}
        />
        {suggestions.length ? (
          <div className="genai-prompt-composer__suggestions" role="listbox" aria-label="Project assets">
            {suggestions.map((option, index) => (
              <ButtonBase type="button" role="option" aria-selected={index === activeIndex}
                className={`genai-prompt-composer__suggestion${index === activeIndex ? ' is-active' : ''}`}
                key={option.asset.id} onMouseDown={(event) => { event.preventDefault(); insertMention(option); }}>
                <span className="genai-prompt-composer__thumb">
                  {previews[option.asset.id] ? <img src={previews[option.asset.id]} alt="" /> : null}
                </span>
                <span><strong>{option.asset.label}</strong><small>{option.token}</small></span>
              </ButtonBase>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};
