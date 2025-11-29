import { Modal } from './components/Modal.js';
import { div } from './components/core.js';
import { Button } from './components/Button.js';
import * as state from '../core/state.js';

const MODAL_KEYS = {
    refresh: 'nitra-refresh-required',
    restart: 'nitra-restart-required',
    postRestartRefresh: 'post-restart-refresh',
};

const SPLASH_FLAG_KEY = 'nitra_show_splash_after_refresh';

const DEFAULT_REFRESH_COPY = {
    title: 'Refresh Required',
    message: 'Refresh this tab to finish applying the latest changes.',
    maxWidth: '520px'
};

const DEFAULT_RESTART_COPY = {
    title: 'Restart Required',
    message: 'Restart ComfyUI so the latest changes can take effect.',
    steps: [
        {
            title: 'Restart ComfyUI',
            description: 'We will monitor the connection and let you know when it is back online.'
        },
        {
            title: 'Refresh this tab',
            description: 'Once ComfyUI reconnects, refresh to finish applying the changes.'
        }
    ],
    restartingMessage: 'Restarting ComfyUI. Keep this tab open—we will notify you when it returns.',
    waitingMessage: 'Restart in progress. You will see a refresh prompt once ComfyUI reconnects.',
    maxWidth: '560px'
};

let restartModal = null;
let restartStatusNode = null;

function setSplashFlag() {
    try {
        window.localStorage.setItem(SPLASH_FLAG_KEY, 'true');
    } catch (error) {
        console.warn('Nitra: Failed to persist refresh flag', error);
    }
}

function modalExists(key) {
    return Boolean(document.querySelector(`[data-nitra-modal="${key}"]`));
}

function mountModal(overlay, key) {
    overlay.dataset.nitraModal = key;
    document.body.appendChild(overlay);
}

function removeModal(overlay) {
    if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
    }
}

function closeRestartModal() {
    if (restartModal) {
        removeModal(restartModal);
        restartModal = null;
        restartStatusNode = null;
    }
}

function createStep(number, title, description) {
    return div(
        { className: 'nitra-modal-step' },
        div({ className: 'nitra-modal-step-badge' }, number),
        div(
            { className: 'nitra-modal-step-content' },
            div({ className: 'nitra-modal-step-title' }, title),
            div({ className: 'nitra-modal-step-text' }, description)
        )
    );
}

async function requestNitraRestart() {
    try {
        const response = await fetch('/nitra/restart', { method: 'GET' });
        let payload = null;
        try {
            payload = await response.clone().json();
        } catch (parseError) {
            payload = null;
        }

        if (!response.ok || (payload && payload.success === false)) {
            const message = payload?.error || `Restart failed (${response.status})`;
            return { success: false, message };
        }

        return { success: true };
    } catch (error) {
        console.log('Nitra: Restart request connection closed (expected if server restarts)', error);
        return { success: true };
    }
}

export function showRefreshPrompt(options = {}) {
    if (modalExists(MODAL_KEYS.refresh)) {
        return;
    }

    const copy = { ...DEFAULT_REFRESH_COPY, ...options };
    const maxWidth = copy.maxWidth || DEFAULT_REFRESH_COPY.maxWidth;

    let overlay = null;
    const close = () => {
        removeModal(overlay);
        overlay = null;
    };

    const handleRefresh = () => {
        setSplashFlag();
        if (typeof copy.onRefresh === 'function') {
            copy.onRefresh();
        } else {
            window.location.reload();
        }
    };

    const refreshButton = Button({
        text: copy.confirmLabel || 'Refresh Now',
        variant: 'secondary',
        id: 'nitra-refresh-now',
        onClick: handleRefresh
    });

    const laterButton = Button({
        text: copy.cancelLabel || 'Later',
        variant: 'primary',
        id: 'nitra-refresh-later',
        onClick: close
    });

    overlay = Modal({
        title: copy.title,
        subtitle: copy.subtitle,
        maxWidth,
        onClose: close,
        showCloseButton: false,
        children: [
            div(
                { className: 'nitra-modal-message' },
                copy.message
            ),
            div({ className: 'nitra-modal-actions' }, laterButton, refreshButton)
        ]
    });

    mountModal(overlay, MODAL_KEYS.refresh);
}

export function showRestartPrompt(options = {}) {
    if (modalExists(MODAL_KEYS.restart)) {
        if (restartStatusNode) {
            restartStatusNode.textContent = options.statusMessage || DEFAULT_RESTART_COPY.statusMessage;
        }
        return;
    }

    const copy = { ...DEFAULT_RESTART_COPY, ...options };
    const steps = Array.isArray(copy.steps) && copy.steps.length > 0 ? copy.steps : DEFAULT_RESTART_COPY.steps;
    const maxWidth = copy.maxWidth || DEFAULT_RESTART_COPY.maxWidth;

    let overlay = null;
    const close = () => {
        removeModal(overlay);
        overlay = null;
        restartModal = null;
        restartStatusNode = null;
    };

    restartStatusNode = div(
        { className: 'nitra-modal-subtext' },
        copy.statusMessage || DEFAULT_RESTART_COPY.statusMessage
    );

    const restartButton = Button({
        text: copy.confirmLabel || 'Restart ComfyUI',
        variant: 'secondary',
        id: 'nitra-restart-now',
        onClick: async () => {
            if (restartButton.disabled) {
                return;
            }

            const originalLabel = restartButton.textContent;
            restartButton.disabled = true;
            restartButton.textContent = copy.restartingLabel || 'Restarting...';
            restartStatusNode.textContent = copy.restartingMessage || DEFAULT_RESTART_COPY.restartingMessage;

            let result;
            if (typeof copy.onRestart === 'function') {
                try {
                    await copy.onRestart();
                    result = { success: true };
                } catch (error) {
                    result = { success: false, message: error?.message || 'Restart failed.' };
                }
            } else {
                result = await requestNitraRestart();
            }

            if (!result.success) {
                restartButton.disabled = false;
                restartButton.textContent = originalLabel;
                restartStatusNode.textContent = result.message;
                return;
            }

            restartStatusNode.textContent = copy.waitingMessage || DEFAULT_RESTART_COPY.waitingMessage;
        }
    });

    const laterButton = Button({
        text: copy.cancelLabel || 'Later',
        variant: 'primary',
        id: 'nitra-restart-later',
        onClick: close
    });

    overlay = Modal({
        title: copy.title,
        subtitle: copy.subtitle,
        maxWidth,
        onClose: close,
        showCloseButton: false,
        children: [
            div(
                { className: 'nitra-modal-message' },
                copy.message
            ),
            div(
                { className: 'nitra-modal-steps' },
                ...steps.map((step, index) => createStep(String(index + 1), step.title, step.description))
            ),
            restartStatusNode,
            div({ className: 'nitra-modal-actions' }, laterButton, restartButton)
        ]
    });

    restartModal = overlay;
    mountModal(overlay, MODAL_KEYS.restart);
}

export function showPostRestartRefreshPrompt() {
    state.setPendingRefreshAfterRestart(false);
    closeRestartModal();

    if (modalExists(MODAL_KEYS.postRestartRefresh)) {
        return;
    }

    let overlay = null;
    const close = () => {
        removeModal(overlay);
        overlay = null;
    };

    const refreshButton = Button({
        text: 'Refresh Now',
        variant: 'secondary',
        id: 'nitra-post-restart-refresh',
        onClick: () => {
            setSplashFlag();
            window.location.reload();
        }
    });

    const laterButton = Button({
        text: 'Later',
        variant: 'primary',
        id: 'nitra-post-restart-refresh-later',
        onClick: close
    });

    overlay = Modal({
        title: 'Restart Complete',
        maxWidth: '520px',
        onClose: close,
        showCloseButton: false,
        children: [
            div(
                { className: 'nitra-modal-message' },
                'ComfyUI is back online. Refresh this tab to continue.'
            ),
            div({ className: 'nitra-modal-actions' }, laterButton, refreshButton)
        ]
    });

    mountModal(overlay, MODAL_KEYS.postRestartRefresh);
}

export function dismissRestartPrompt() {
    closeRestartModal();
}

