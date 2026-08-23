// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import type { ScratchtrackProject } from './types';

/**
 * End-to-end Scratch isolation: the reported bug was "edit Scratch B and
 * Scratch A appears to change". These tests drive real UI paths and prove
 * A's serialized data is byte-for-byte unchanged after B is created and edited.
 */

const SAVE_DEBOUNCE_MS = 140;

async function flushSave() {
  await new Promise((resolve) => setTimeout(resolve, SAVE_DEBOUNCE_MS));
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function storedProject(): ScratchtrackProject {
  const raw = localStorage.getItem('scratchtrack.project.v1');
  expect(raw).toBeTruthy();
  return JSON.parse(raw!);
}

function drumScratches(project: ScratchtrackProject) {
  return project.tracks.find((track) => track.kind === 'drum')!.scratches;
}

function synthScratches(project: ScratchtrackProject) {
  return project.tracks.find((track) => track.kind === 'synth')!.scratches;
}

/** Place a note by tapping the composer canvas at a given beat/row position. */
function tapMotifCanvas(beat: number, rowsFromTop: number) {
  const canvas = document.querySelector('.motif-canvas') as HTMLElement;
  const rect = { left: 0, top: 0 };
  const clientX = rect.left + beat * 46 + 8;
  const clientY = rect.top + rowsFromTop * 26 + 10;
  fireEvent.pointerDown(canvas, { clientX, clientY, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX, clientY, pointerId: 1 });
}

describe('scratch isolation through the UI', () => {
  it('editing a duplicated drum scratch never mutates the original', async () => {
    render(<App />);
    await flushSave();
    const snapshot = JSON.stringify(drumScratches(storedProject())[0]);

    // Create Scratch B via Duplicate (a deliberate deep copy of A's pattern).
    fireEvent.click(screen.getAllByRole('button', { name: '⧉ Duplicate Scratch' })[0]);
    await flushSave();
    const afterDuplicate = drumScratches(storedProject());
    expect(afterDuplicate).toHaveLength(2);
    expect(JSON.stringify(afterDuplicate[0])).toBe(snapshot);

    // Edit B: cycle several steps to accent level, change kit + settings.
    for (const label of ['Kick step 3', 'Snare step 7', 'Hat step 11']) {
      fireEvent.pointerDown(screen.getByLabelText(label));
      fireEvent.pointerDown(screen.getByLabelText(label));
    }
    fireEvent.change(screen.getAllByDisplayValue('Pocket')[0], { target: { value: 'Modern' } });
    fireEvent.change(screen.getByLabelText('Swing'), { target: { value: '0.8' } });
    await flushSave();

    // A must still be byte-for-byte identical.
    const scratchesAfterEdit = drumScratches(storedProject());
    expect(JSON.stringify(scratchesAfterEdit[0])).toBe(snapshot);
    expect(scratchesAfterEdit[1]!.drumKit).toBe('Modern');
    expect(scratchesAfterEdit[1]!.drumSettings!.swing).toBeCloseTo(0.8, 6);
  });

  it('a brand-new drum scratch shares no state with the original either', async () => {
    render(<App />);
    await flushSave();
    const snapshot = JSON.stringify(drumScratches(storedProject())[0]);

    fireEvent.click(screen.getAllByRole('button', { name: '＋ New Scratch' })[0]);
    for (const label of ['Kick step 5', 'Open step 16']) {
      fireEvent.pointerDown(screen.getByLabelText(label));
    }
    await flushSave();
    expect(JSON.stringify(drumScratches(storedProject())[0])).toBe(snapshot);
  });

  it('synth motifs stay independent between scratches', async () => {
    render(<App />);
    await flushSave();
    fireEvent.click(screen.getByText('Synth'));

    // Write two notes into Scratch A by tapping the composer canvas.
    tapMotifCanvas(0, 2);
    tapMotifCanvas(1.5, 5);
    await flushSave();

    const original = synthScratches(storedProject())[0];
    expect(original.synthNotes).toHaveLength(2);
    const snapshot = JSON.stringify(original);

    // Duplicate → then delete one note from the copy inside the composer.
    fireEvent.click(screen.getAllByRole('button', { name: '⧉ Duplicate Scratch' })[0]);
    expect(document.querySelectorAll('.motif-note').length).toBe(2);
    fireEvent.pointerDown(document.querySelectorAll('.motif-note')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await flushSave();

    expect(document.querySelectorAll('.motif-note').length).toBe(1);
    expect(JSON.stringify(synthScratches(storedProject())[0])).toBe(snapshot);
    expect(synthScratches(storedProject())[1].synthNotes).toHaveLength(1);
  });

  it('audio metadata survives duplication untouched', async () => {
    render(<App />);
    await flushSave();
    // Simulate a recorded audio scratch in storage.
    const withAudio = storedProject();
    const audioTrack = withAudio.tracks.find((track) => track.kind === 'audio')!;
    audioTrack.scratches.push({
      id: 'audio-scratch-1',
      name: 'Take 1',
      note: '',
      createdAt: new Date().toISOString(),
      audioBlobId: 'blob-xyz',
      audioMimeType: 'audio/wav',
      audioDuration: 2.4,
    } as never);
    audioTrack.activeScratchId = 'audio-scratch-1';
    localStorage.setItem('scratchtrack.project.v1', JSON.stringify(withAudio));

    cleanup();
    render(<App />);
    await flushSave();
    fireEvent.click(screen.getByText('Audio 1'));
    const before = JSON.stringify(audioTrack.scratches[0]);

    fireEvent.click(screen.getAllByRole('button', { name: '＋ New Scratch' })[0]);
    await flushSave();
    const after = synthAndAudio(storedProject());
    expect(after.audio.scratches.map((scratch: { id?: string }) => scratch.id)).toContain('audio-scratch-1');
    const kept = JSON.stringify(after.audio.scratches.find((scratch: { id?: string }) => scratch.id === 'audio-scratch-1'));
    expect(JSON.parse(kept)).toEqual(JSON.parse(before));
  });
});

function synthAndAudio(project: ScratchtrackProject) {
  return {
    audio: project.tracks.find((track) => track.kind === 'audio')!,
    synth: project.tracks.find((track) => track.kind === 'synth')!,
  };
}
