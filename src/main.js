import './styles/main.css';
import { store } from './state/store.js';
import { AudioSynth } from './engine/AudioSynth.js';
import { StageEngine } from './engine/StageEngine.js';
import { AppController } from './ui/appController.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvasContainer = document.getElementById('stage-canvas-container');
  const beatCanvas = document.getElementById('beat-visualizer-canvas');

  const audioSynth = new AudioSynth(beatCanvas);
  const stageEngine = new StageEngine(canvasContainer, store, audioSynth, (idx) => {
    const lbl = document.getElementById('lbl-selected-fixture');
    if (lbl) lbl.textContent = `Moving Head Beam #${idx + 1}`;
  });

  stageEngine.init();

  const controller = new AppController(store, stageEngine, audioSynth);
  controller.init();
});
