const SOUND_ENABLED_KEY = 'manna-sound-effects-enabled';

let audioContext = null;
let audioUnlocked = false;
let userGestureReceived = false;

function isSoundEnabled() {
  return localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
}

function unlockAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  userGestureReceived = true;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === 'running') {
    audioUnlocked = true;
    return;
  }
  audioContext.resume().then(() => {
    audioUnlocked = audioContext.state === 'running';
  }).catch(() => {});
}

window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio);

function playTone(frequency, startTime, duration, volume = 0.045, type = 'sine') {
  if (!audioContext || !audioUnlocked) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

export function playSoundEffect(name) {
  if (!isSoundEnabled()) return;
  if (!userGestureReceived || !audioContext) return;
  if (audioContext.state !== 'running') {
    audioContext.resume().then(() => {
      audioUnlocked = audioContext.state === 'running';
      if (audioUnlocked) playSoundEffect(name);
    }).catch(() => {});
    return;
  }
  audioUnlocked = true;
  const startTime = audioContext.currentTime + 0.01;
  const patterns = {
    click: [[620, 0, 0.07, 0.025, 'triangle']],
    promotion: [[660, 0, 0.11, 0.025], [880, 0.085, 0.16, 0.035]],
    reward: [[523, 0, 0.18, 0.035], [659, 0.11, 0.2, 0.04], [784, 0.22, 0.3, 0.045]],
    notification: [[880, 0, 0.09, 0.025], [1175, 0.12, 0.12, 0.025]]
  };
  (patterns[name] || []).forEach(([frequency, offset, duration, volume, type]) => {
    playTone(frequency, startTime + offset, duration, volume, type || 'sine');
  });
}

export function renderSoundToggle() {
  const enabled = isSoundEnabled();
  return `<button class="ghost-btn notification-sound-toggle" type="button" data-sound-toggle aria-pressed="${enabled}">${enabled ? 'Sounds on' : 'Sounds off'}</button>`;
}

export function bindSoundToggle(root = document) {
  root.querySelectorAll('[data-sound-toggle]').forEach((button) => {
    if (button.dataset.soundToggleBound) return;
    button.dataset.soundToggleBound = 'true';
    button.addEventListener('click', () => {
      const enabled = !isSoundEnabled();
      localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
      button.textContent = enabled ? 'Sounds on' : 'Sounds off';
      button.setAttribute('aria-pressed', String(enabled));
      if (enabled) playSoundEffect('click');
    });
  });
}