import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Duration from './Duration.svelte';

const setup = (secs: number) => {
  const onchange = vi.fn();
  render(Duration, { props: { id: 'rotate', label: 'Rotate every', secs, onchange } });
  const box = screen.getByLabelText('Rotate every') as HTMLInputElement;
  const unit = screen.getByLabelText('Rotate every: unit') as HTMLSelectElement;
  return { onchange, box, unit };
};

describe('Duration', () => {
  it('shows seconds as the largest unit that divides them', () => {
    const { box, unit } = setup(7200);
    expect(box.value).toBe('2');
    expect(unit.value).toBe('h');
    document.body.innerHTML = '';
    const days = setup(172_800);
    expect([days.box.value, days.unit.value]).toEqual(['2', 'd']);
    document.body.innerHTML = '';
    const mins = setup(300);
    expect([mins.box.value, mins.unit.value]).toEqual(['5', 'm']);
    document.body.innerHTML = '';
    const secs = setup(90);
    expect([secs.box.value, secs.unit.value]).toEqual(['90', 's']);
  });

  it('reports the number in seconds as it is typed, and an empty box as NaN', async () => {
    const { onchange, box } = setup(3600);
    await fireEvent.input(box, { target: { value: '3' } });
    expect(onchange).toHaveBeenLastCalledWith(10_800);
    await fireEvent.input(box, { target: { value: '' } });
    expect(onchange).toHaveBeenLastCalledWith(NaN);
  });

  it('keeps the number and reports the new total when the unit changes', async () => {
    const { onchange, unit } = setup(1800);
    await fireEvent.change(unit, { target: { value: 'h' } });
    expect(onchange).toHaveBeenLastCalledWith(108_000);
    await fireEvent.change(unit, { target: { value: 's' } });
    expect(onchange).toHaveBeenLastCalledWith(30);
    await fireEvent.change(unit, { target: { value: 'd' } });
    expect(onchange).toHaveBeenLastCalledWith(30 * 86_400);
  });
});
