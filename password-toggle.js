document.addEventListener('DOMContentLoaded', () => {
    const wrappers = document.querySelectorAll('.password-input-wrap');

    wrappers.forEach((wrapper) => {
        if (wrapper.dataset.passwordToggleBound === 'true') return;
        wrapper.dataset.passwordToggleBound = 'true';

        const input = wrapper.querySelector('input[type="password"], input[type="text"]');
        const toggleButton = wrapper.querySelector('.password-toggle');

        if (!input || !toggleButton) return;

        const updateToggle = () => {
            const isHidden = input.type === 'password';
            toggleButton.setAttribute('aria-label', isHidden ? 'Show password' : 'Hide password');
            toggleButton.setAttribute('title', isHidden ? 'Show password' : 'Hide password');
            toggleButton.innerHTML = isHidden
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 13.4 13.4"/><path d="M9 5.5A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.8 18.8 0 0 1-4.1 5.2"/><path d="M6.1 6.1A18.7 18.7 0 0 0 2 12s3.5 6 10 6a10.8 10.8 0 0 0 3.5-.6"/></svg>';
        };

        updateToggle();
        toggleButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const shouldShow = input.type === 'password';
            input.type = shouldShow ? 'text' : 'password';
            updateToggle();
            input.focus();
        });
    });
});
