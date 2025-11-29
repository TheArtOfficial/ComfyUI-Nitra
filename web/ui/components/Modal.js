// Modal component
// NEW CODE - Component library

import { div, button } from './core.js';

export function Modal({ 
    title,
    subtitle,
    children,
    onClose,
    maxWidth = '600px',
    showCloseButton = true
}) {
    // Create overlay
    const overlay = div({ 
        className: 'nitra-modal-overlay',
        onClick: (e) => {
            if (e.target === overlay && onClose) {
                onClose();
            }
        }
    });
    
    // Create modal content
    const modal = div(
        { 
            className: 'nitra-modal',
            style: { maxWidth }
        },
        title && div(
            { className: 'nitra-modal-header' },
            div(
                { className: 'nitra-modal-title-group' },
                div({ className: 'nitra-modal-title' }, title),
                subtitle && div({ className: 'nitra-modal-subtitle' }, subtitle)
            ),
            (onClose && showCloseButton)
                ? button(
                    { 
                        className: 'nitra-modal-close',
                        onClick: onClose
                    },
                    '×'
                )
                : null
        ),
        div({ className: 'nitra-modal-body' }, ...children)
    );
    
    overlay.appendChild(modal);
    
    return overlay;
}









