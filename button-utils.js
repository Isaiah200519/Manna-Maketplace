/* Manna Marketplace button lifecycle helpers. */
(function () {
    function restoreButton(button, original) {
        if (!button) return;
        button.innerHTML = original.html;
        button.style.background = original.background;
        button.style.color = original.color;
        button.style.borderColor = original.borderColor;
        button.disabled = original.disabled;
        button.classList.remove('btn-loading', 'btn-success', 'btn-error');
    }

    window.withButtonState = async function (button, action, options = {}) {
        if (!button || typeof action !== 'function') return;
        const original = {
            html: button.innerHTML,
            background: button.style.background,
            color: button.style.color,
            borderColor: button.style.borderColor,
            disabled: button.disabled
        };
        const loadingText = options.loadingText || 'Working...';
        const successText = options.successText || 'Done';
        const errorText = options.errorText || 'Failed - Retry';

        button.disabled = true;
        button.innerHTML = `<span class="btn-spinner"></span>${loadingText}`;
        button.classList.remove('btn-success', 'btn-error');
        button.classList.add('btn-loading');

        try {
            const result = await action();
            button.classList.remove('btn-loading', 'btn-error');
            button.classList.add('btn-success');
            button.innerHTML = successText;
            if (!options.permanent) window.setTimeout(() => restoreButton(button, original), 2000);
            return result;
        } catch (error) {
            console.error('[Manna] Button action failed:', error);
            button.classList.remove('btn-loading', 'btn-success');
            button.classList.add('btn-error');
            button.innerHTML = errorText;
            button.disabled = false;
            window.setTimeout(() => restoreButton(button, original), 2500);
            throw error;
        }
    };

    window.setButtonReflectedState = function (button, state, text = 'Done') {
        if (!button || state !== 'success') return;
        button.classList.remove('btn-loading', 'btn-error');
        button.classList.add('btn-success');
        button.innerHTML = text;
        button.disabled = true;
    };
})();
