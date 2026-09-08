import { describe, expect, test } from 'bun:test';
import {
  createProjectStackSpacingSnapshotStore,
  reorderProjectStackSpacingSeams,
  type ProjectStackSpacingResolved,
} from '../../src/lib/projectStack';

const viewports = ['desktop', 'tablet', 'mobile'] as const;
const resolved = (desktop: ProjectStackSpacingResolved['desktop'], tablet = desktop, mobile = tablet) => ({
  desktop, tablet, mobile,
});

type State = {
  document: string;
  currentValue: ProjectStackSpacingResolved;
  visualSavedValue: ProjectStackSpacingResolved;
};

const reorder = (states: State[], sourceIndex: number, insertIndex: number) => {
  const visualSaved = states.map((state) => ({ ...state.visualSavedValue }));
  const maps = viewports.map((viewport) => reorderProjectStackSpacingSeams(
    states.map((state) => state.currentValue[viewport]),
    sourceIndex,
    insertIndex,
    undefined,
    states.map((state) => state.currentValue[viewport] !== state.visualSavedValue[viewport]),
  ));
  states.forEach((state, index) => viewports.forEach((viewport, viewportIndex) => {
    const map = maps[viewportIndex];
    state.currentValue[viewport] = map.values[index];
    const origin = map.origins[index];
    state.visualSavedValue[viewport] = origin === null
      ? map.values[index]
      : visualSaved[origin][viewport];
  }));
};

describe('project stack spacing reorder transactions', () => {
  test('round trips authored spacing across every viewport', () => {
    const states: State[] = [
      { document: 'home-intro', currentValue: resolved('none', 'none', 'none'), visualSavedValue: resolved('none', 'none', 'none') },
      { document: 'home-intro', currentValue: resolved('major', 'group', 'section'), visualSavedValue: resolved('major', 'group', 'section') },
      { document: 'home-intro', currentValue: resolved('related', 'section', 'group'), visualSavedValue: resolved('related', 'section', 'group') },
    ];
    const before = states.map((state) => ({ currentValue: { ...state.currentValue }, visualSavedValue: { ...state.visualSavedValue } }));
    const store = createProjectStackSpacingSnapshotStore<State>();
    store.capture('home-intro', states);
    reorder(states, 0, 1);
    reorder(states, 1, 0);
    store.restore('home-intro', (state, snapshot) => Object.assign(state, snapshot));
    expect(states.map(({ currentValue, visualSavedValue }) => ({ currentValue, visualSavedValue }))).toEqual(before);
  });

  test('one-way reorder keeps seam behavior', () => {
    const states: State[] = [
      { document: 'home-intro', currentValue: resolved('none'), visualSavedValue: resolved('none') },
      { document: 'home-intro', currentValue: resolved('related'), visualSavedValue: resolved('related') },
      { document: 'home-intro', currentValue: resolved('section'), visualSavedValue: resolved('section') },
    ];
    reorder(states, 0, 1);
    expect(states.map((state) => state.currentValue.desktop)).toEqual(['section', 'none', 'related']);
  });

  test('snapshots are scoped by document', () => {
    const home: State = { document: 'home', currentValue: resolved('major'), visualSavedValue: resolved('major') };
    const intro: State = { document: 'home-intro', currentValue: resolved('group'), visualSavedValue: resolved('group') };
    const store = createProjectStackSpacingSnapshotStore<State>();
    store.capture('home', [home, intro]);
    home.currentValue.desktop = 'none';
    intro.currentValue.desktop = 'none';
    store.restore('home-intro', (state, snapshot) => Object.assign(state, snapshot));
    expect(intro.currentValue.desktop).toBe('none');
    store.restore('home', (state, snapshot) => Object.assign(state, snapshot));
    expect(home.currentValue.desktop).toBe('major');
  });
});
