import { describe, expect, it } from 'vitest';
import { canTransition, nextStatuses, STATUS, STATUS_LABELS } from './status.js';

describe('状态机流转规则', () => {
  it('WISHLIST 可流转到 APPLIED/REJECTED/WITHDRAWN', () => {
    expect(canTransition(STATUS.WISHLIST, STATUS.APPLIED)).toBe(true);
    expect(canTransition(STATUS.WISHLIST, STATUS.REJECTED)).toBe(true);
    expect(canTransition(STATUS.WISHLIST, STATUS.WITHDRAWN)).toBe(true);
    expect(canTransition(STATUS.WISHLIST, STATUS.OFFER)).toBe(false);
  });

  it('APPLIED 可直接进入笔试/面试/Offer', () => {
    expect(canTransition(STATUS.APPLIED, STATUS.WRITTEN_TEST)).toBe(true);
    expect(canTransition(STATUS.APPLIED, STATUS.INTERVIEW_1)).toBe(true);
    expect(canTransition(STATUS.APPLIED, STATUS.OFFER)).toBe(true);
  });

  it('终态不可再流转', () => {
    expect(nextStatuses(STATUS.REJECTED)).toEqual([]);
    expect(nextStatuses(STATUS.SIGNED)).toEqual([]);
    expect(canTransition(STATUS.REJECTED, STATUS.APPLIED)).toBe(false);
  });

  it('OFFER 只能到 签约/拒绝/放弃', () => {
    expect(canTransition(STATUS.OFFER, STATUS.SIGNED)).toBe(true);
    expect(canTransition(STATUS.OFFER, STATUS.INTERVIEW_1)).toBe(false);
  });

  it('不允许原地流转', () => {
    expect(canTransition(STATUS.APPLIED, STATUS.APPLIED)).toBe(false);
  });

  it('每个状态都有中文标签', () => {
    for (const s of Object.values(STATUS)) {
      expect(STATUS_LABELS[s]).toBeTruthy();
    }
  });
});
