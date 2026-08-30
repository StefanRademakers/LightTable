import { describe, expect, it } from 'vitest';
import { menuPosition } from '../../../ui/src/menuPosition';

describe('package menu positioning', () => {
  it('opens above a footer trigger and clamps to the viewport', () => {
    expect(menuPosition(
      { left: 36, right: 62, top: 730, bottom: 756 },
      { width: 220, height: 680 },
      { width: 1280, height: 768 }, 'auto', 'end', 40, 6
    )).toEqual({ left: 8, top: 44, maxHeight: 720 });
  });

  it('flips below a top-edge trigger', () => {
    expect(menuPosition(
      { left: 400, right: 426, top: 10, bottom: 36 },
      { width: 220, height: 300 },
      { width: 800, height: 600 }, 'auto', 'end', 40, 6
    )).toEqual({ left: 206, top: 42, maxHeight: 552 });
  });
  it('flips submenus left near the right viewport edge', () => {
    expect(menuPosition({left:600,right:790,top:560,bottom:588},
      {width:220,height:300},{width:800,height:600},'submenu'))
      .toEqual({left:378,top:292,maxHeight:584});
  });
  it('limits tall menus to the viewport without shrinking their rows', () => {
    expect(menuPosition({left:100,right:128,top:200,bottom:228},
      {width:220,height:900},{width:800,height:600},'auto','end',40,6))
      .toEqual({left:8,top:40,maxHeight:552});
  });
});
