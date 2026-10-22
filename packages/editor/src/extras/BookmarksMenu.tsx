import { Menu } from "../ui/primitives/Overlays";
import { getCommand, isEnabled, runCommand } from '../commands/registry';
import { t } from '../i18n';
import { keysFor } from '../shortcuts/shortcuts';
import { Icon } from '../ui/primitives/Icon';
import { KbdText } from '../ui/primitives/Kbd';
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass, menuShortcutClass } from '../ui/primitives/menuStyles';
import { bookmarkCommand, useBookmarks } from './bookmarkActions';

export function BookmarksMenu({ hoverEnabled = true }: { hoverEnabled?: boolean }) {
  const entries = useBookmarks(s => s.entries);
  return <Menu.SubmenuRoot highlightItemOnHover={hoverEnabled}>
    <Menu.SubmenuTrigger openOnHover={hoverEnabled} data-submenu="bookmarks" className={menuItemClass}>
      <span className="flex-1">{t('bookmarks.title')}</span><Icon name="chevronRight" size={12} className="text-faint" />
    </Menu.SubmenuTrigger>
    <Menu.Portal><Menu.Positioner side="right" align="start" className={menuPositionerClass}>
      <Menu.Popup className={`${menuPopupClass} max-h-(--available-height) max-w-90 overflow-y-auto`} data-bookmarks-menu>
        <Menu.Item className={menuItemClass} data-command="bookmark.add" disabled={!getCommand('bookmark.add') || !isEnabled(getCommand('bookmark.add')!)} onClick={() => runCommand('bookmark.add')}>
          <span className="flex-1">{t('bookmarks.add')}</span><KbdText keys={keysFor('bookmark.add')[0] ?? ''} className={menuShortcutClass} />
        </Menu.Item>
        <Menu.Separator className={menuSeparatorClass} />
        {!entries.length && <Menu.Item className={menuItemClass} disabled>{t('bookmarks.empty')}</Menu.Item>}
        {entries.map((bookmark, index) => <Menu.SubmenuRoot highlightItemOnHover={hoverEnabled} key={bookmark.id}>
          <Menu.SubmenuTrigger openOnHover={hoverEnabled} className={menuItemClass} data-bookmark={bookmark.id}>
            <span className="min-w-0 flex-1 truncate">{bookmark.name}</span>
            {index < 9 && <KbdText keys={keysFor(`bookmark.${index + 1}` as 'bookmark.1')[0] ?? ''} className={menuShortcutClass} />}
            <Icon name="chevronRight" size={12} className="text-faint" />
          </Menu.SubmenuTrigger>
          <Menu.Portal><Menu.Positioner side="right" align="start" className={menuPositionerClass}>
            <Menu.Popup className={`${menuPopupClass} max-h-(--available-height) overflow-y-auto`}>
              <Menu.Item className={menuItemClass} data-bookmark-action="jump" onClick={() => bookmarkCommand('jump', bookmark.id)}>{t('bookmarks.jump')}</Menu.Item>
              <Menu.Item className={menuItemClass} data-bookmark-action="rename" onClick={() => bookmarkCommand('rename', bookmark.id)}>{t('bookmarks.rename')}</Menu.Item>
              <Menu.Item className={`${menuItemClass} text-danger`} data-bookmark-action="delete" onClick={() => bookmarkCommand('delete', bookmark.id)}>{t('bookmarks.delete')}</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner></Menu.Portal>
        </Menu.SubmenuRoot>)}
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal>
  </Menu.SubmenuRoot>;
}
