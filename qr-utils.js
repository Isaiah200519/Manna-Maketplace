import { createToast } from './utils.js';

const MANNA_MARKETPLACE_PLATFORM_URL = 'https://manna-marketplace.netlify.app/customer';
const QR_CODE_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
let qrCodeLibraryPromise = null;

export function getQRCardHTML(containerId = 'mannaQrContainer', cardId = 'mannaQrCard') {
    return `
    <div class="qr-card" id="${cardId}">
      <div class="qr-card__header">
        <div class="qr-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M7 6h10a1 1 0 011 1v10a1 1 0 01-1 1H7a1 1 0 01-1-1V7a1 1 0 011-1z" />
            <path d="M10 10h4v4h-4z" />
            <path d="M8 3v3M16 3v3M8 18v3M16 18v3M3 8h3M3 16h3M18 8h3M18 16h3" />
          </svg>
        </div>
        <div>
          <div class="qr-card__eyebrow">Share Manna Marketplace</div>
          <h4 class="qr-card__title">Invite friends to the platform</h4>
        </div>
      </div>
      <p class="qr-card__text">Scan this QR code to open Manna Marketplace on mobile and start exploring or signing up instantly.</p>
      <div id="${containerId}" class="qr-card__canvas" aria-label="QR code for Manna Marketplace"></div>
      <div class="qr-card__actions">
        <button class="primary-btn qr-card__download-btn" type="button" data-qr-download="${containerId}">Download QR Code</button>
        <button class="ghost-btn qr-card__copy-btn" type="button" data-qr-copy="${containerId}">Copy Link</button>
        <button class="ghost-btn qr-card__open-btn" type="button" data-qr-open="${containerId}">Open Link</button>
      </div>
    </div>
  `;
}

function loadQRCodeLibrary() {
    if (window.QRCode) return Promise.resolve();
    if (qrCodeLibraryPromise) return qrCodeLibraryPromise;

    qrCodeLibraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = QR_CODE_LIBRARY_URL;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('QR code library failed to load.'));
        document.head.appendChild(script);
    }).catch((error) => {
        qrCodeLibraryPromise = null;
        throw error;
    });

    return qrCodeLibraryPromise;
}

async function renderQRCode(container, url) {
    try {
        await loadQRCodeLibrary();
        if (!container.isConnected) return;
        if (!window.QRCode) throw new Error('QR code library did not initialize.');

        new window.QRCode(container, {
            text: url,
            width: 256,
            height: 256,
            colorDark: '#F97316',
            colorLight: '#1e1e1e',
            correctLevel: window.QRCode.CorrectLevel.H
        });
        container.dataset.qrState = 'ready';
    } catch (error) {
        console.error('[Manna Marketplace] QR code generation failed:', error);
        const message = document.createElement('p');
        message.setAttribute('role', 'status');
        message.textContent = 'QR code could not be loaded. Check your connection and try again.';
        container.replaceChildren(message);
        container.dataset.qrState = 'failed';
    }
}

export function initQRCode(containerId, url = MANNA_MARKETPLACE_PLATFORM_URL) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    if (container.dataset.qrState === 'ready') {
        return container.querySelector('canvas, img');
    }
    if (container.dataset.qrState) return null;
    container.dataset.qrState = 'pending';

    const observer = 'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            renderQRCode(container, url);
        }, { rootMargin: '100px' })
        : null;

    if (observer) {
        observer.observe(container);
    } else {
        renderQRCode(container, url);
    }
    return null;
}

export function downloadQR(containerId, filename = 'manna-qr.png') {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const sourceNode = container.querySelector('canvas, img');
    if (!sourceNode) return false;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 1024;
    exportCanvas.height = 1024;
    const context = exportCanvas.getContext('2d');
    if (!context) return false;

    context.fillStyle = '#1e1e1e';
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    const padding = 96;
    const targetSize = exportCanvas.width - (padding * 2);
    context.drawImage(sourceNode, padding, padding, targetSize, targetSize);

    context.strokeStyle = '#F97316';
    context.lineWidth = 24;
    context.strokeRect(padding - 12, padding - 12, targetSize + 24, targetSize + 24);

    const link = document.createElement('a');
    link.download = filename;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    return true;
}

export async function copyInviteLink(containerId, url = MANNA_MARKETPLACE_PLATFORM_URL) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            return true;
        }

        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
    } catch (error) {
        console.warn('[Manna Marketplace] Unable to copy invite link.', error);
        return false;
    }
}

export function openInviteLink(containerId, url = MANNA_MARKETPLACE_PLATFORM_URL) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
}

export function bindQRDownloadHandlers() {
    document.querySelectorAll('[data-qr-download]').forEach((button) => {
        button.onclick = () => {
            downloadQR(button.dataset.qrDownload);
        };
    });

    document.querySelectorAll('[data-qr-copy]').forEach((button) => {
        button.onclick = async () => {
            const containerId = button.dataset.qrCopy;
            const copied = await copyInviteLink(containerId);
            if (copied) {
                const originalLabel = button.textContent;
                button.textContent = 'Copied!';
                createToast('Invite link copied to clipboard.', 'success');
                window.setTimeout(() => {
                    button.textContent = originalLabel;
                }, 1800);
            } else {
                createToast('Unable to copy invite link.', 'error');
            }
        };
    });

    document.querySelectorAll('[data-qr-open]').forEach((button) => {
        button.onclick = () => {
            const containerId = button.dataset.qrOpen;
            const opened = openInviteLink(containerId);
            if (opened) {
                createToast('Invite link opened in a new tab.', 'success');
            } else {
                createToast('Unable to open the invite link.', 'error');
            }
        };
    });
}
