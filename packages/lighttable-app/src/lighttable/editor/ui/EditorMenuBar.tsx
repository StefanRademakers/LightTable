import { MenuBar, type MenuOption, type MenuBarItem } from '@lighttable/ui';
import { ButtonBase } from '../../../ui/ButtonBase';
import type { EditorMenuId } from '../menus/createEditorMenuOptions';
import { lightTableIcon } from '../../../assets/icons';
import { getAppTheme, setAppTheme } from '../../../ui/appTheme';

export interface EditorMenuBarProps {
  readonly optionsFor: (id: EditorMenuId) => Array<MenuOption<string>>;
  readonly projectName?: string;
  readonly onRevealProject?: () => void;
  readonly enabledFor?: (id: EditorMenuId) => boolean;
}

const MENU_ITEMS: readonly MenuBarItem<EditorMenuId>[] = [
  { value: 'file', label: 'File' }, { value: 'edit', label: 'Edit' },
  { value: 'image', label: 'Image' }, { value: 'layer', label: 'Layer' },
  { value: 'type', label: 'Type' }, { value: 'select', label: 'Select' },
  { value: 'filter', label: 'Filter' }, { value: 'ai', label: 'AI' },
  { value: 'view', label: 'View' },
  ...(import.meta.env.DEV ? [{ value: 'developer' as const, label: 'Developer' }] : []),
  { value: 'help', label: 'Help' }
];

/** Document capabilities stay in LightTable; the package owns menu interaction. */
export const EditorMenuBar = ({ optionsFor, projectName, onRevealProject,
  enabledFor = () => true }: EditorMenuBarProps) => (
  <div className="shots-app-menu lighttable__app-menu">
    <span className="lighttable__window-icon" aria-hidden="true" />
    <MenuBar label="LightTable menu" data-editor-native-tab-navigation
      items={MENU_ITEMS.map(item => ({ ...item, disabled: item.value !== 'view' && !enabledFor(item.value) }))}
      optionsFor={id => {
        const options = optionsFor(id);
        return id !== 'view' ? options : [...options, {
          value: 'theme', label: 'Theme', separatorBefore: options.length > 0,
          children: (['light', 'dark'] as const).map(theme => ({
            value: `theme-${theme}`, label: theme === 'light' ? 'Light' : 'Dark',
            selected: getAppTheme() === theme, onClick: () => setAppTheme(theme)
          }))
        }];
      }} />
    {projectName ? <ButtonBase type="button" className="lighttable__project-name"
      title={`Open project folder: ${projectName}`} aria-label={`Open project folder for ${projectName}`}
      onClick={onRevealProject}>
      <img src={lightTableIcon('folder.png')} alt="" aria-hidden />
      <span>{projectName}</span>
    </ButtonBase> : null}
  </div>
);
