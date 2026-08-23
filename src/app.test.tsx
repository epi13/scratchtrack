// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import App from './App';

/**
 * Render-level smoke tests. Web Audio is unavailable in jsdom; every audio call
 * site is lazily triggered by user interaction, so the app must render and take
 * edits purely on state.
 */

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => cleanup());

describe('app shell', () => {
  it('renders eight tracks and the transport without crashing', () => {
    render(<App />);
    expect(screen.getAllByText('Drums').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Synth').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bass').length).toBeGreaterThan(0);
    expect(screen.getByText('Audio 1')).toBeTruthy();
    expect(screen.getByText('Audio 5')).toBeTruthy();
    expect(screen.getByLabelText('Play')).toBeTruthy();
    expect(screen.getByLabelText('Time signature')).toBeTruthy();
  });

  it('shows a starter drum pattern with 16 steps at 4/4', () => {
    render(<App />);
    expect(screen.getByText(/16 steps\/bar/)).toBeTruthy();
    expect(screen.getByLabelText('Kick step 1')).toBeTruthy();
    expect(screen.getByLabelText('Kick step 16')).toBeTruthy();
    // Starter kick accents at steps 1 and 9.
    expect((screen.getByLabelText('Kick step 1') as HTMLButtonElement).className).toContain('level-2');
    expect((screen.getByLabelText('Kick step 9') as HTMLButtonElement).className).toContain('level-2');
  });

  it('edits drum steps through the shared update path', () => {
    render(<App />);
    const kick2 = screen.getByLabelText('Kick step 2');
    expect(kick2.className).not.toContain('level-1');
    fireEvent.pointerDown(kick2);
    expect((screen.getByLabelText('Kick step 2') as HTMLButtonElement).className).toContain('level-1');
  });

  it('changes subdivision to triplets (12 steps) preserving timing', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Drum subdivision'), { target: { value: '1/8t' } });
    expect(screen.getByText(/12 steps per bar/)).toBeTruthy();
    // Snare at beat 1.25 of 16 sixteenths maps to nearest triplet position.
    const snareHits = Array.from({ length: 12 }, (_, index) =>
      (screen.queryByLabelText(`Snare step ${index + 1}`) as HTMLButtonElement | null)?.className.includes('level-') ?? false);
    expect(snareHits.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('switches meter to 7/8 and remaps the grid to 14 steps', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Beats per bar'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Note value per beat'), { target: { value: '8' } });
    expect(screen.getByText(/14 steps\/bar/)).toBeTruthy();
    expect(screen.getByLabelText('Kick step 14')).toBeTruthy();
    expect(screen.queryByLabelText('Kick step 15')).toBeNull();
  });

  it('toggles the scratch drawer between − and + with correct ARIA state', () => {
    render(<App />);
    const initiallyOpen = screen.getByLabelText('Close Drums scratches');
    expect(initiallyOpen.textContent).toBe('−');
    expect(initiallyOpen.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(initiallyOpen);
    const closed = screen.getByLabelText('Open Drums scratches');
    expect(closed.textContent).toBe('+');
    expect(closed.getAttribute('aria-expanded')).toBe('false');
  });

  it('New Scratch keeps sound settings but starts with a clean pattern', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '＋ New Scratch' })[0]);
    expect(screen.getAllByDisplayValue('Pocket').length).toBeGreaterThan(0);
    const freshKick1 = screen.getByLabelText('Kick step 1') as HTMLButtonElement;
    expect(freshKick1.className).toContain('level-0');
    expect(freshKick1.className).not.toContain('level-1');
    expect(freshKick1.className).not.toContain('level-2');
    // The new scratch became active in an opened drawer.
    expect(screen.getAllByText('Scratch B').length).toBeGreaterThan(0);
  });

  it('Duplicate Scratch deep-copies the current pattern', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '⧉ Duplicate Scratch' })[0]);
    expect((screen.getByLabelText('Kick step 1') as HTMLButtonElement).className).toContain('level-2');
    expect((screen.getByLabelText('Kick step 9') as HTMLButtonElement).className).toContain('level-2');
  });

  it('loop In/Out accept typed bar.beat values and reject nonsense gracefully', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop' })); // enable the loop region
    const out = screen.getByLabelText('Out point as bar.beat') as HTMLInputElement;
    fireEvent.change(out, { target: { value: '3.1' } });
    fireEvent.blur(out);
    // Loop region reflects 0 → beat 8 (bar 3) at 4/4 across 64 beats.
    const loopRegion = document.querySelector('.loop-region') as HTMLElement | null;
    expect(loopRegion?.style.width).toBe('12.5%');
    fireEvent.change(out, { target: { value: 'nonsense' } });
    fireEvent.blur(out);
    expect(out.value).toMatch(/^\d+\.\d$/); // reverted to formatted position
  });

  it('shows the multi-stage compression toggle on audio tracks', () => {
    render(<App />);
    fireEvent.click(screen.getByText('Audio 1'));
    expect(screen.getByRole('button', { name: /Multi-stage comp Off/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Multi-stage comp Off/ }));
    expect(screen.getByRole('button', { name: /Multi-stage comp On/ })).toBeTruthy();
  });
});
