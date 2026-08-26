(function () {
    let overlay = null;
    let previewImage = null;
    let previewTitle = null;

    function ensureOverlay() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'image-preview-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="image-preview-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
                <button class="image-preview-close" type="button" aria-label="Close image preview">&times;</button>
                <img class="image-preview-image" alt="" />
                <div class="image-preview-caption"></div>
            </div>`;
        document.body.appendChild(overlay);

        previewImage = overlay.querySelector('.image-preview-image');
        previewTitle = overlay.querySelector('.image-preview-caption');
        overlay.querySelector('.image-preview-close').addEventListener('click', closePreview);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closePreview();
        });
    }

    function openPreview(image) {
        const source = image.currentSrc || image.src;
        if (!source) return;
        ensureOverlay();
        previewImage.src = source;
        previewImage.alt = image.alt || 'Image preview';
        previewTitle.textContent = image.alt || 'Image preview';
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('image-preview-open');
        overlay.querySelector('.image-preview-close').focus();
    }

    function closePreview() {
        if (!overlay) return;
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('image-preview-open');
        previewImage.removeAttribute('src');
    }

    document.addEventListener('click', (event) => {
        const image = event.target.closest('img');
        if (!image || image.closest('.image-preview-overlay')) return;
        event.preventDefault();
        openPreview(image);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePreview();
    });
})();
