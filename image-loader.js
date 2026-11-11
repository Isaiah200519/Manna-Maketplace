(() => {
    const selector = 'img[data-mobile-loader]';
    const placeholder = './images/placeholder.png';
    const isMobile = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;

    function loadImage(image) {
        if (image.dataset.loaderStarted) return;
        image.dataset.loaderStarted = 'true';

        const sources = [...new Set([image.dataset.mobileSrc, image.dataset.fullSrc].filter(Boolean))];
        let sourceIndex = 0;

        const tryNextSource = () => {
            if (sourceIndex >= sources.length) {
                image.onerror = null;
                image.onload = null;
                image.src = placeholder;
                return;
            }

            image.onerror = tryNextSource;
            image.onload = () => {
                image.onerror = null;
                image.onload = null;
            };
            image.src = sources[sourceIndex++];
        };

        tryNextSource();
    }

    function observeImage(image) {
        if (image.dataset.loaderObserved || image.dataset.loaderStarted) return;
        image.dataset.loaderObserved = 'true';

        if (!isMobile) {
            loadImage(image);
            return;
        }

        if (!observer) {
            loadImage(image);
            return;
        }
        observer.observe(image);
    }

    const observer = 'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                observer.unobserve(entry.target);
                loadImage(entry.target);
            });
        }, { rootMargin: '600px 0px' })
        : null;

    function scan(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches(selector)) observeImage(node);
            node.querySelectorAll(selector).forEach(observeImage);
        } else if (node.nodeType === Node.DOCUMENT_NODE) {
            node.querySelectorAll(selector).forEach(observeImage);
        }
    }

    scan(document);
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => mutation.addedNodes.forEach(scan));
    }).observe(document.documentElement, { childList: true, subtree: true });
})();