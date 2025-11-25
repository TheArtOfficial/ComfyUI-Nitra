import * as state from '../../core/state.js';

export function createCloseButton(options = {}) {
    const { title = 'Close', onClick } = options;

    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = '&times;';
    button.title = title;
    button.style.cssText = `
        background: #000000;
        border: 1px solid #ffffff;
        color: #ffffff;
        border-radius: 10px;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        box-shadow: 0 0 12px rgba(255, 255, 255, 0.2);
    `;

    const handleHover = (isHovering) => {
        if (isHovering) {
            button.style.transform = 'translateY(-1px)';
            button.style.boxShadow = '0 0 18px rgba(255,255,255,0.5)';
        } else {
            button.style.transform = 'translateY(0)';
            button.style.boxShadow = '0 0 12px rgba(255, 255, 255, 0.2)';
        }
    };

    button.addEventListener('mouseenter', () => handleHover(true));
    button.addEventListener('mouseleave', () => handleHover(false));

    button.addEventListener('click', () => {
        if (typeof onClick === 'function') {
            const shouldContinue = onClick();
            if (shouldContinue === false) {
                return;
            }
        }

        const dialog = state.nitraDialog;
        if (dialog?.parentElement) {
            dialog.parentElement.removeChild(dialog);
            state.setNitraDialog(null);
        }
    });

    return button;
}

