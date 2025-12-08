// List item component
// NEW CODE - Component library

import { div, input, span } from './core.js';

export function ListItem({ 
    id, 
    title, 
    description, 
    meta, 
    tags = [], 
    checked = false,
    disabled = false,
    onChange,
    rightContent
}) {
    const checkboxId = `item-${id}`;

    // Fix for core.js setAttribute behavior with booleans
    // Only pass the prop if it is true.
    const inputProps = {
        type: 'checkbox',
        id: checkboxId,
        value: id,
        style: { marginRight: '15px', transform: 'scale(1.1)', cursor: disabled ? 'default' : 'pointer' },
        onClick: (e) => {
            e.stopPropagation();
            if (!disabled && onChange) onChange(e.target.checked);
        }
    };

    if (checked) inputProps.checked = 'checked';
    if (disabled) inputProps.disabled = 'disabled';

    const checkbox = input(inputProps);
    
    // Title row with space-between
    const titleRow = div(
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', overflow: 'hidden' } },
        div({ className: 'nitra-list-item-title', style: { fontSize: '0.9em', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 } }, title || 'Unnamed Item'),
        rightContent && div({ className: 'nitra-list-item-right', style: { marginLeft: '10px', fontSize: '0.85em', opacity: 0.8, flexShrink: 0 } }, rightContent)
    );
    
    const content = div(
        { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden', minWidth: 0 } },
        titleRow,
        description && div({ className: 'nitra-list-item-description', style: { fontSize: '0.8em', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, description),
        meta && div({ className: 'nitra-list-item-meta' }, meta),
        tags.length > 0 && div(
            { style: { marginTop: '4px' } },
            ...tags.map(tag => span({ className: 'nitra-tag' }, tag))
        )
    );
    
    return div(
        {
            className: 'nitra-list-item',
            style: {
                opacity: disabled ? 0.6 : 1,
                cursor: disabled ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '10px 12px'
            },
            onClick: () => {
                if (disabled) return;
                const el = document.getElementById(checkboxId);
                if (el) el.click();
            }
        },
        checkbox,
        content
    );
}
