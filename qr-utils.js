import { createToast } from './utils.js';

const MANNA_MARKETPLACE_PLATFORM_URL = 'https://isaiah200519.github.io/Manna-Maketplace/';

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

function drawFallbackQRCode(canvas, url) {
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#1e1e1e';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#F97316';
    context.fillRect(24, 24, 208, 208);
    context.fillStyle = '#1e1e1e';
    context.fillRect(40, 40, 176, 176);
    context.fillStyle = '#F97316';
    context.fillRect(56, 56, 144, 144);
    context.fillStyle = '#1e1e1e';
    context.fillRect(72, 72, 112, 112);
    context.fillStyle = '#F97316';
    context.fillRect(88, 88, 80, 80);

    context.fillStyle = '#ffffff';
    context.font = '14px Inter, sans-serif';
    context.textAlign = 'center';
    context.fillText('Manna Marketplace', canvas.width / 2, canvas.height - 20);
    context.font = '12px Inter, sans-serif';
    context.fillText(url.replace('https://', ''), canvas.width / 2, canvas.height - 4);
}

export function initQRCode(containerId, url = MANNA_MARKETPLACE_PLATFORM_URL) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    if (container.dataset.qrInitialized === 'true') {
        return container.querySelector('canvas, img');
    }

    container.innerHTML = '';

    if (typeof window !== 'undefined' && window.QRCode) {
        try {
            new window.QRCode(container, {
                text: url,
                width: 256,
                height: 256,
                colorDark: '#F97316',
                colorLight: '#1e1e1e',
                correctLevel: window.QRCode.CorrectLevel.H
            });
            container.dataset.qrInitialized = 'true';
            return container.querySelector('canvas, img');
        } catch (error) {
            console.warn('[Manna Marketplace] QR code generation failed, using fallback renderer.', error);
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    container.appendChild(canvas);

    drawFallbackQRCode(canvas, url);
    container.dataset.qrInitialized = 'true';
    return canvas;
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
