import { SegmentedControl, Button } from '@lighttable/ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import manifestData from '../ui/uiComponentManifest.json';
import inventoryData from '../ui/generatedUiUsageInventory.json';
import { SearchField } from '../ui/SearchField';


import type { UiInspectionTarget } from '../ui/uiInspection';

interface ManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly packageStatus: 'ready' | 'coupled';
}

interface UsageLocation {
  readonly path: string;
  readonly count: number;
  readonly kind?: 'internal' | 'product';
}

interface ComponentUsage {
  readonly id: string;
  readonly metadataDeclared: boolean;
  readonly productionUsageCount: number;
  readonly internalUsageCount: number;
  readonly contextCount: number;
  readonly overrideCount: number;
  readonly locations: readonly UsageLocation[];
  readonly overrides: readonly { path: string; roots: readonly string[] }[];
}

const manifest = manifestData as readonly ManifestEntry[];
const inventory = inventoryData as {
  readonly components: readonly ComponentUsage[];
  readonly nativeCandidates: readonly {
    id: string;
    label: string;
    count: number;
    fileCount: number;
    locations: readonly UsageLocation[];
  }[];
  readonly deepSelectorCount: number;
  readonly deepestSelectors: readonly { path: string; selector: string; depth: number }[];
};

const usageById = new Map(inventory.components.map((entry) => [entry.id, entry]));

interface RuntimeCandidate {
  readonly auditId: string;
  readonly kind: 'Button' | 'Dropdown' | 'Slider' | 'Field' | 'Menu/List' | 'Window/Dialog';
  readonly element: string;
  readonly label: string;
  readonly className: string;
  readonly context: string;
}

interface RuntimeSnapshot {
  readonly counts: Readonly<Record<string, number>>;
  readonly unregistered: readonly RuntimeCandidate[];
}

const COMPOUND_CONTROL_IDS = new Set([
  'search-field',
  'segmented-control',
  'adjustment-slider',
  'color-swatch',
  'color-picker',
  'panel-select',
  'panel-file',
  'panel-checkbox',
  'panel-angle',
  'context-menu'
]);

const runtimeCandidateLabel = (element: HTMLElement): string => {
  const explicit = element.getAttribute('aria-label') || element.getAttribute('title');
  if (explicit) return explicit;
  const childLabels = [...element.querySelectorAll<HTMLElement>(
    ':scope > [role="tab"], :scope > [role="menuitem"], :scope > [role="option"]'
  )].slice(0, 5).map((child) =>
    child.getAttribute('aria-label') || child.textContent?.trim().replaceAll(/\s+/g, ' ')
  ).filter(Boolean);
  if (childLabels.length) return childLabels.join(' / ');
  return element.textContent?.trim().replaceAll(/\s+/g, ' ').slice(0, 80)
    || element.className?.toString().split(/\s+/)[0]
    || 'Unnamed interactive element';
};

const inspectRuntimeControls = (): RuntimeSnapshot => {
  const guide = document.querySelector('.lighttable-ui-guide');
  const outsideGuide = (element: Element) => !guide?.contains(element);
  const markers = [...document.querySelectorAll<HTMLElement>('[data-suite-control]')]
    .filter(outsideGuide);
  const counts: Record<string, number> = {};
  for (const marker of markers) {
    const id = marker.dataset.suiteControl;
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }

  document.querySelectorAll<HTMLElement>('[data-suite-audit-id]')
    .forEach((element) => { delete element.dataset.suiteAuditId; });
  const candidates = [...document.querySelectorAll<HTMLElement>(
    'button, select, input:not([type="hidden"]), [role="button"], [role="slider"], [role="menuitem"], [role="dialog"], [role="menu"], [role="listbox"], [role="tree"], [role="tablist"]'
  )].filter(outsideGuide).filter((element) => element.getClientRects().length > 0);
  const unregistered = candidates.filter((element) => {
    if (element.dataset.suiteControl) return false;
    const owner = element.closest<HTMLElement>('[data-suite-control]')?.dataset.suiteControl;
    return !owner || !COMPOUND_CONTROL_IDS.has(owner);
  }).map((element, index) => {
    const role = element.getAttribute('role');
    const inputType = element instanceof HTMLInputElement ? element.type : '';
    const kind: RuntimeCandidate['kind'] = role === 'dialog'
      ? 'Window/Dialog'
      : role === 'menu' || role === 'listbox' || role === 'tree' || role === 'tablist'
        ? 'Menu/List'
        : element instanceof HTMLSelectElement ? 'Dropdown'
          : role === 'slider' || inputType === 'range' ? 'Slider'
            : element instanceof HTMLButtonElement || role === 'button' || role === 'menuitem'
              ? 'Button'
              : 'Field';
    const auditId = `ui-audit-${index}`;
    element.dataset.suiteAuditId = auditId;
    return {
    auditId,
    kind,
    element: element.tagName.toLowerCase(),
    label: runtimeCandidateLabel(element),
    className: element.className?.toString().trim() || 'no class',
    context: element.parentElement?.closest<HTMLElement>('[aria-label], [role="dialog"], section, aside, nav')
      ?.getAttribute('aria-label') || 'application surface'
  };
  });
  return { counts, unregistered };
};

const riskFor = (usage: ComponentUsage) => {
  if (usage.overrideCount > 0) return 'override';
  if (usage.productionUsageCount === 0) return 'unused';
  if (usage.productionUsageCount === 1) return 'single';
  return 'shared';
};

type CoverageView = 'nonstandard' | 'attention' | 'approved' | 'all';

const needsAttention = (component: ManifestEntry, usage: ComponentUsage) =>
  component.packageStatus === 'coupled'
  || !usage.metadataDeclared
  || usage.overrideCount > 0;

const isNonStandard = (component: ManifestEntry, usage: ComponentUsage) =>
  component.id === 'button-base' || !usage.metadataDeclared;

interface UiCoverageSpecimenProps {
  readonly inspection?: UiInspectionTarget | null;
  readonly onShowInApp?: (controlId: string | null, auditId?: string) => void;
}

export const UiCoverageSpecimen: React.FC<UiCoverageSpecimenProps> = ({
  inspection = null,
  onShowInApp
}) => {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<CoverageView>('attention');
  const selectedEntryRef = useRef<HTMLDetailsElement>(null);
  const [runtime, setRuntime] = useState<RuntimeSnapshot>({ counts: {}, unregistered: [] });
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setRuntime(inspectRuntimeControls()));
    return () => {
      window.cancelAnimationFrame(frame);
      document.querySelectorAll<HTMLElement>('[data-suite-audit-id]')
        .forEach((element) => { delete element.dataset.suiteAuditId; });
    };
  }, []);
  const unidentifiedByKind = useMemo(() => {
    const groups = new Map<RuntimeCandidate['kind'], RuntimeCandidate[]>();
    for (const candidate of runtime.unregistered) {
      const group = groups.get(candidate.kind) ?? [];
      group.push(candidate);
      groups.set(candidate.kind, group);
    }
    return [...groups.entries()];
  }, [runtime.unregistered]);
  useEffect(() => {
    if (!inspection) return;
    setView('all');
    setQuery('');
  }, [inspection]);
  useEffect(() => {
    if (!inspection?.controlId || view !== 'all' || query) return undefined;
    const frame = window.requestAnimationFrame(() => {
      selectedEntryRef.current?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspection, query, view]);
  const entries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return manifest
      .map((component) => ({ component, usage: usageById.get(component.id) }))
      .filter((entry): entry is { component: ManifestEntry; usage: ComponentUsage } => Boolean(entry.usage))
      .filter(({ component, usage }) => view === 'all'
        || (view === 'nonstandard' ? isNonStandard(component, usage)
          : (view === 'attention') === needsAttention(component, usage)))
      .filter(({ component, usage }) => !normalized
        || component.name.toLowerCase().includes(normalized)
        || component.family.toLowerCase().includes(normalized)
        || usage.locations.some(({ path }) => path.toLowerCase().includes(normalized)))
      .sort((left, right) => right.usage.overrideCount - left.usage.overrideCount
        || left.usage.productionUsageCount - right.usage.productionUsageCount
        || left.component.name.localeCompare(right.component.name));
  }, [query, view]);

  const totalProductUsages = inventory.components.reduce(
    (total, component) => total + component.productionUsageCount,
    0
  );
  const overrideCount = inventory.components.reduce(
    (total, component) => total + component.overrideCount,
    0
  );
  const provisionalButtonCount = usageById.get('button-base')?.productionUsageCount ?? 0;
  const attentionCount = manifest.filter((component) => {
    const usage = usageById.get(component.id);
    return usage ? needsAttention(component, usage) : true;
  }).length;
  const approvedCount = manifest.length - attentionCount;
  const inspectedComponent = inspection?.controlId
    ? manifest.find((component) => component.id === inspection.controlId)
    : undefined;

  return (
    <div className="lighttable-ui-coverage">
      <div className="lighttable-ui-coverage__summary" aria-label="UI coverage summary">
        <span><strong>{manifest.length}</strong> canonical controls</span>
        <span><strong>{totalProductUsages}</strong> production instances</span>
        <span className={provisionalButtonCount ? 'is-warning' : undefined}>
          <strong>{provisionalButtonCount}</strong> provisional button surfaces
        </span>
        <span className={runtime.unregistered.length ? 'is-warning' : undefined}>
          <strong>{runtime.unregistered.length}</strong> unregistered live controls
        </span>
        <span className={overrideCount ? 'is-warning' : undefined}>
          <strong>{overrideCount}</strong> external override files
        </span>
        <span className={inventory.deepSelectorCount ? 'is-warning' : undefined}>
          <strong>{inventory.deepSelectorCount}</strong> deep selectors
        </span>
      </div>

      {inspection ? (
        <aside className="lighttable-ui-coverage__inspection" aria-label="Inspected application control">
          <div>
            <strong>{inspectedComponent?.name ?? 'Unregistered control'}</strong>
            <span>{inspection.controlId ? `${inspection.controlId} · ` : ''}{inspection.label}</span>
          </div>
          <dl>
            <div><dt>Status</dt><dd>{inspection.status ?? (inspection.controlId ? 'registered' : 'unregistered')}</dd></div>
            <div><dt>Element</dt><dd>{inspection.element}</dd></div>
            <div><dt>Context</dt><dd>{inspection.context}</dd></div>
            <div><dt>Classes</dt><dd>{inspection.className || 'none'}</dd></div>
          </dl>
          {onShowInApp ? (
            <Button data-ui-theme="dark" onClick={() => onShowInApp(inspection.controlId)}>
              Show in app
            </Button>
          ) : null}
        </aside>
      ) : null}

      <p className="lighttable-ui-coverage__inspect-hint">
        Inspect in app: Ctrl+Shift+Alt-click · macOS: Cmd+Shift+Option-click
      </p>

      <div className="lighttable-ui-coverage__tools">
        <SegmentedControl data-ui-theme="dark" label="UI coverage view" value={view} onChange={setView}
          options={[
            { value: 'nonstandard', label: 'Non-standard' },
            { value: 'attention', label: `Attention ${attentionCount}` },
            { value: 'approved', label: `Approved ${approvedCount}` },
            { value: 'all', label: `All ${manifest.length}` }
          ]} />
        <SearchField
          aria-label="Filter UI coverage"
          placeholder="Find a control or source"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      <div className="lighttable-ui-coverage__table" role="table" aria-label="Canonical control usage">
        <div className="lighttable-ui-coverage__row lighttable-ui-coverage__row--header" role="row">
          <span role="columnheader">Control</span>
          <span role="columnheader">Family</span>
          <span role="columnheader">Use</span>
          <span role="columnheader">Live</span>
          <span role="columnheader">Contexts</span>
          <span role="columnheader">Overrides</span>
        </div>
        {entries.map(({ component, usage }) => {
          const selected = component.id === inspection?.controlId;
          return (
          <details className={`lighttable-ui-coverage__entry${selected ? ' is-inspected' : ''}`}
            key={component.id} open={selected || (view === 'nonstandard' && isNonStandard(component, usage)) || undefined}
            ref={selected ? selectedEntryRef : undefined}>
            <summary className="lighttable-ui-coverage__row" data-risk={riskFor(usage)}>
              <strong>{component.name}</strong>
              <span>{component.family}</span>
              <span>{usage.productionUsageCount}</span>
              <span>{runtime.counts[component.id] ?? 0}</span>
              <span>{usage.contextCount}</span>
              <span>{usage.overrideCount}</span>
            </summary>
            <div className="lighttable-ui-coverage__details">
              <p>
                Classification {isNonStandard(component, usage) ? 'provisional/non-standard' : 'canonical'} · package {component.packageStatus} · runtime metadata {usage.metadataDeclared ? 'registered' : 'missing'} · {usage.internalUsageCount} internal compositions
              </p>
              {usage.locations.length ? (
                <>
                <ul>
                  {usage.locations.slice(0, 8).map((location) => (
                    <li key={`${component.id}-${location.path}`}>
                      <code>{location.path}</code><span>{location.count}×</span>
                    </li>
                  ))}
                </ul>
                {usage.locations.length > 8 ? (
                  <details className="lighttable-ui-coverage__more-locations">
                    <summary>Show {usage.locations.length - 8} more source locations</summary>
                    <ul>
                      {usage.locations.slice(8).map((location) => (
                        <li key={`${component.id}-${location.path}`}>
                          <code>{location.path}</code><span>{location.count}×</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                </>
              ) : <p>No source usages found.</p>}
              {usage.overrides.map((override) => (
                <p className="lighttable-ui-coverage__warning" key={override.path}>
                  External CSS reaches {override.roots.join(', ')} in <code>{override.path}</code>
                </p>
              ))}
            </div>
          </details>
          );
        })}
      </div>

      <section className={`lighttable-ui-coverage__candidates${view === 'nonstandard' ? ' is-primary-view' : ''}`}>
        <h5>{view === 'nonstandard' ? 'Non-standard control surfaces' : 'Custom-control candidates'}</h5>
        <p>Provisional surfaces require visual classification. Raw native elements require review, not automatic deletion.</p>
        <div>
          <details open={view === 'nonstandard' || undefined}>
            <summary>Unidentified live controls<span>{runtime.unregistered.length}</span></summary>
            <div className="lighttable-ui-coverage__runtime-groups">
              {unidentifiedByKind.map(([kind, candidates]) => (
                <details key={kind} open={view === 'nonstandard' || undefined}>
                  <summary>{kind}<span>{candidates.length}</span></summary>
                  <ul>
                    {candidates.map((candidate) => (
                      <li className="lighttable-ui-coverage__runtime-candidate" key={candidate.auditId}>
                        <div>
                          <code title={candidate.className}>{candidate.label}</code>
                          <span>{candidate.element} · {candidate.context}</span>
                        </div>
                        {onShowInApp ? (
                          <Button data-ui-theme="dark" onClick={() => onShowInApp(null, candidate.auditId)}>
                            Show in app
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </details>
          {inventory.nativeCandidates.map((candidate) => (
            <details key={candidate.id} open={view === 'nonstandard' && candidate.count > 0 || undefined}>
              <summary>{candidate.label}<span>{candidate.count} in {candidate.fileCount} files</span></summary>
              <ul>
                {candidate.locations.map((location) => (
                  <li key={`${candidate.id}-${location.path}`}>
                    <code>{location.path}</code><span>{location.count}×</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>

      <details className="lighttable-ui-coverage__selectors">
        <summary>Deep cascade candidates<span>{inventory.deepSelectorCount}</span></summary>
        <ul>
          {inventory.deepestSelectors.map((entry, index) => (
            <li key={`${entry.path}-${index}`}>
              <code>{entry.selector}</code><span>depth {entry.depth} · {entry.path}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};
