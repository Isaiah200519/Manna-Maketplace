import { escapeHtml } from './utils.js';

const DESCRIPTION_SELECTOR = '.expandable-description';
const descriptionStates = new WeakMap();
let observerStarted = false;
const MAX_DESCRIPTION_LINES = 3;

export function renderExpandableDescription(value) {
  const text = String(value || '').trim();
  return `<div class="muted expandable-description" data-full-text="${escapeHtml(text)}">${escapeHtml(text)}</div>`;
}

function renderDescription(element) {
  let state = descriptionStates.get(element);
  if (!state) {
    const fullText = element.dataset.fullText || element.textContent || '';
    const textNode = document.createTextNode(fullText);
    element.replaceChildren(textNode);
    state = { fullText, textNode, spacer: null, button: null, expanded: false };
    descriptionStates.set(element, state);
  }

  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
    || Number.parseFloat(getComputedStyle(element).fontSize) * 1.4;
  const maxHeight = lineHeight * MAX_DESCRIPTION_LINES;

  element.style.maxHeight = 'none';
  element.style.overflow = 'visible';
  state.textNode.nodeValue = state.fullText;

  if (state.expanded) {
    element.style.maxHeight = 'none';
    element.style.overflow = 'visible';
    if (state.button) {
      state.button.textContent = 'View less';
      state.button.setAttribute('aria-expanded', 'true');
    }
    return;
  }

  state.button?.remove();
  state.spacer?.remove();
  if (element.scrollHeight <= maxHeight + 1) {
    state.button = null;
    state.spacer = null;
    return;
  }

  if (!state.button) {
    state.button = document.createElement('button');
    state.button.type = 'button';
    state.button.className = 'expandable-description-toggle';
    state.button.setAttribute('aria-expanded', 'false');
    state.button.addEventListener('click', () => {
      state.expanded = !state.expanded;
      state.button.textContent = state.expanded ? 'View less' : 'View more';
      state.button.setAttribute('aria-expanded', String(state.expanded));
      renderDescription(element);
    });
  }

  state.button.textContent = 'View more';
  state.button.setAttribute('aria-expanded', 'false');
  state.spacer = document.createTextNode(' ');
  element.append(state.spacer, state.button);
  element.style.maxHeight = `${maxHeight}px`;
  element.style.overflow = 'hidden';

  const words = state.fullText.match(/\S+\s*/g) || [];
  let low = 0;
  let high = words.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    state.textNode.nodeValue = `${words.slice(0, middle).join('').trimEnd()}... `;
    if (element.scrollHeight <= element.clientHeight + 1) low = middle;
    else high = middle - 1;
  }

  state.textNode.nodeValue = `${words.slice(0, low).join('').trimEnd()}... `;
}

export function initializeExpandableDescriptions(root = document) {
  const descriptions = [];
  if (root.matches?.(DESCRIPTION_SELECTOR)) descriptions.push(root);
  descriptions.push(...(root.querySelectorAll?.(DESCRIPTION_SELECTOR) || []));
  descriptions.forEach(renderDescription);

  if (observerStarted || !document.body) return;
  observerStarted = true;

  const observer = new MutationObserver((records) => {
    const addedDescriptions = new Set();
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches(DESCRIPTION_SELECTOR)) addedDescriptions.add(node);
      node.querySelectorAll(DESCRIPTION_SELECTOR).forEach((element) => addedDescriptions.add(element));
    }));
    addedDescriptions.forEach(renderDescription);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      initializeExpandableDescriptions(document);
    });
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initializeExpandableDescriptions(document), { once: true });
  } else {
    initializeExpandableDescriptions(document);
  }
}