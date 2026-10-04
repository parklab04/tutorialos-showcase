import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, BookOpen, CalendarDays, Check, ChevronDown, FileText, MapPin, RotateCcw, ShieldCheck, Sun } from 'lucide-react';
import { copy } from '../../shared/copy';
import type { LessonId } from '../lessons/types';
import './safari-practice.css';

export interface SafariPracticeState {
  menu: 'view' | 'bookmarks' | 'history' | null;
  zoom: number;
  reader: boolean;
  bookmarkDialog: boolean;
  bookmarked: boolean;
  tabOpen: boolean;
}

export function initialSafariState(lessonId: LessonId): SafariPracticeState {
  return { menu: null, zoom: 100, reader: false, bookmarkDialog: false, bookmarked: false, tabOpen: lessonId !== 'safari-reopen-tab' };
}

interface Props {
  lessonId: LessonId;
  onAction: (action: string) => void;
  onSceneChange: (state: SafariPracticeState) => void;
}

export function SafariPractice({ lessonId, onAction, onSceneChange }: Props) {
  const [scene, setScene] = useState(() => initialSafariState(lessonId));
  const change = (patch: Partial<SafariPracticeState>, action?: string) => {
    const next = { ...scene, ...patch };
    setScene(next);
    onSceneChange(next);
    if (action) onAction(action);
  };
  useEffect(() => {
    if (!scene.bookmarkDialog) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = { ...scene, bookmarkDialog: false };
      setScene(next);
      onSceneChange(next);
      onAction('cancel-bookmark');
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [scene, onAction, onSceneChange]);

  const openMenu = (menu: Exclude<SafariPracticeState['menu'], null>) => {
    const opening = scene.menu !== menu;
    change({ menu: opening ? menu : null, bookmarkDialog: false }, opening ? `open-${menu}-menu` : undefined);
  };

  return <div className="safari-scene safari-practice">
    <div className="safari-menubar" aria-label="Safari practice menus">
      <strong>Safari</strong>
      {(['view', 'history', 'bookmarks'] as const).map(menu => <div className="safari-practice-menu-wrap" key={menu}>
        <button data-guide-target={`${menu}-menu`} className={`menu-trigger ${scene.menu === menu ? 'selected' : ''}`} aria-expanded={scene.menu === menu} aria-haspopup="menu" onClick={() => openMenu(menu)}>
          {menu === 'view' ? 'View' : menu === 'history' ? 'History' : 'Bookmarks'}<ChevronDown size={15} />
        </button>
        {scene.menu === menu && <div className="safari-menu" role="menu" aria-label={menu === 'view' ? 'View' : menu === 'history' ? 'History' : 'Bookmarks'}>
          {menu === 'view' && <>
            <button role="menuitem" data-guide-target="zoom-in" disabled={!scene.tabOpen} onClick={() => change({ zoom: scene.zoom + 20, menu: null }, 'zoom-in')}><span>{copy.practice.safari.zoomIn}</span><span aria-hidden="true">⌘ +</span></button>
            <button role="menuitem" data-guide-target={scene.reader ? 'hide-reader' : 'show-reader'} disabled={!scene.tabOpen} onClick={() => change({ reader: !scene.reader, menu: null }, scene.reader ? 'hide-reader' : 'show-reader')}><span>{scene.reader ? 'Hide Reader' : 'Show Reader'}</span><BookOpen size={18} /></button>
          </>}
          {menu === 'bookmarks' && <button role="menuitem" data-guide-target="add-bookmark" disabled={!scene.tabOpen} onClick={() => change({ bookmarkDialog: true, menu: null }, 'add-bookmark')}><span>Add Bookmark…</span><Bookmark size={18} /></button>}
          {menu === 'history' && <button role="menuitem" data-guide-target="reopen-closed-tab" disabled={scene.tabOpen} onClick={() => change({ tabOpen: true, menu: null }, 'reopen-closed-tab')}><span>Reopen Last Closed Tab</span><RotateCcw size={18} /></button>}
        </div>}
      </div>)}
    </div>
    <div className="safari-address"><span aria-hidden="true"><ArrowLeft size={18} /><ArrowRight size={18} /></span><div><ShieldCheck size={16} />{scene.tabOpen ? lessonId === 'safari-zoom' ? copy.practice.safari.pageLabel : 'Community practice page' : 'Start Page'}</div></div>
    <div className="safari-practice-tabs"><span className={scene.tabOpen ? 'active' : ''}><FileText size={16} />{scene.tabOpen ? copy.practice.safari.pageTitle : 'Start Page'}</span>{scene.bookmarked && <span className="safari-saved-badge" role="status"><Check size={16} />Saved to Favorites</span>}</div>
    {scene.tabOpen ? <div className={scene.reader ? 'safari-practice-article reader-on' : 'safari-practice-article'}>
      {!scene.reader && <div className="safari-site-nav" aria-hidden="true"><span>Community</span><span>Activities</span><span>Visit us</span></div>}
      <div className="safari-article-layout">
        <article className="sample-webpage" style={{ fontSize: `${scene.zoom}%` }}>
          <div className="sample-overline">{scene.reader ? <><BookOpen size={18} />Reader view</> : 'Reading practice'}</div>
          <h2>{copy.practice.safari.pageTitle}</h2>
          <p>{copy.practice.safari.pageBody}</p>
          {scene.reader ? <p>Find a class you enjoy, meet your neighbors, and learn something new.</p> : <div className="sample-note"><FileText size={22} /><span>A sample article for practicing Safari.</span></div>}
        </article>
        {!scene.reader && <aside className="safari-article-extra" aria-label="Sample community notice"><div className="safari-community-art" aria-hidden="true"><Sun size={35} /><span /><i /></div><strong>This week</strong><span><CalendarDays size={16} />Community classes</span><span><MapPin size={16} />At the center</span></aside>}
      </div>
    </div> : <div className="safari-closed-tab"><span><RotateCcw size={34} /></span><h2>Your practice tab is closed.</h2><p>Bring back the community guide.</p></div>}
    {scene.bookmarkDialog && <section className="safari-bookmark-dialog" role="dialog" aria-modal="false" aria-label="Add Bookmark — Practice">
      <div className="safari-bookmark-heading"><Bookmark size={25} /><h2>Add Bookmark</h2><span>Practice</span></div>
      <dl><div><dt>Add this page to:</dt><dd>Favorites</dd></div><div><dt>Name:</dt><dd>{copy.practice.safari.pageTitle}</dd></div></dl>
      <div className="safari-bookmark-actions"><button className="button secondary" onClick={() => change({ bookmarkDialog: false }, 'cancel-bookmark')}>Cancel</button><button className="button primary" data-guide-target="save-bookmark" onClick={() => change({ bookmarked: true, bookmarkDialog: false }, 'save-bookmark')}>Add</button></div>
    </section>}
    <div className="scene-statusbar"><span>{scene.reader ? 'Practice · Reader view' : lessonId === 'safari-reopen-tab' && scene.tabOpen ? 'Practice · Tab restored' : 'Practice webpage'}</span><span>{copy.practice.safari.zoomLabel} <strong>{scene.zoom}%</strong></span></div>
  </div>;
}
