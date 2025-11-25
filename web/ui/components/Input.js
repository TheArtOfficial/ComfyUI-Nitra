// Input component
// NEW CODE - Component library

import { div, label as labelElement, input } from './core.js';

export function Input({ 
    label: labelText, 
    type = 'text', 
    placeholder = '',
    value = '',
    onChange,
    required = false,
    id,
    size = 'default'
}) {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    
    const classes = ['nitra-input'];
    if (size === 'small') classes.push('nitra-input-small');
    
    const inputEl = input({
        type,
        placeholder,
        value,
        id: inputId,
        required,
        className: classes.join(' '),
        onInput: (e) => onChange && onChange(e.target.value)
    });
    
    if (labelText) {
        return div(
            { className: 'nitra-input-group' },
            labelElement({ for: inputId, className: 'nitra-hf-token-label' }, labelText),
            inputEl
        );
    }
    
    return inputEl;
}










