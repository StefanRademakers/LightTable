import { useEffect } from 'react';

/**
 * Native desktop dropdowns commit a choice and return keyboard control to the
 * application. This also covers portal-mounted dialogs and menus because the
 * listener lives on the document rather than an individual editor surface.
 */
export const useReleaseSelectFocusAfterChange = () => {
  useEffect(() => {
    const releaseChangedSelect = (event: Event) => {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement)) return;
      queueMicrotask(() => {
        if (select.isConnected && document.activeElement === select) select.blur();
      });
    };

    document.addEventListener('change', releaseChangedSelect, true);
    return () => document.removeEventListener('change', releaseChangedSelect, true);
  }, []);
};
