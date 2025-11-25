// Button component
// NEW CODE - Component library

import { button } from './core.js';

export function Button({ 
    text, 
    onClick, 
    variant = 'primary', 
    disabled = false,
    large = false,
    icon = null,
    id = null
}) {
    // Build CSS classes
    const classes = ['nitra-btn', `nitra-btn-${variant}`];
    if (large) classes.push('nitra-btn-large');
    if (icon) classes.push('nitra-btn-with-icon');
    
    // Build props object
    const props = {
        className: classes.join(' '),
        onClick
    };
    
    if (id) props.id = id;
    if (disabled) props.disabled = disabled;
    
    // Create button element
    const btnElement = icon ? button(props, icon, text) : button(props, text);
    
    // Debug: Verify button and handler are connected
    if (onClick) {
        console.log('Nitra: Button created with id:', id, 'onClick:', typeof onClick);
    }
    
    return btnElement;
}

