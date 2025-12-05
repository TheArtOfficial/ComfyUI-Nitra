// Workflow UI rendering
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { updateWorkflowInstallButton } from './selection.js';
import { fetchWorkflowDetails } from './api.js';

let workflowCategoryFilter = 'all';
const WORKFLOW_VERSION_KEYS = [
    'updated_at',
    'updatedAt',
    'dateUpdated',
    'date_updated',
    'dateModified',
    'modified_at',
    'modifiedAt',
    'lastUpdated',
    'workflow_updated_at'
];
const WORKFLOW_RENDER_BATCH_SIZE = 12;
const workflowCardCache = new Map();
const workflowMediaHydration = new Map();
const workflowMediaBuffer = new Map();
let workflowRenderToken = 0;
let workflowIdFallbackCounter = 0;
let workflowSortOption = 'name-asc';
const WORKFLOW_CREATED_KEYS = [
    'created_at',
    'createdAt',
    'dateCreated',
    'date_created',
    'created',
    'createdISO',
    'workflow_created_at'
];

// Hydration queue to limit concurrent requests
const pendingHydrationQueue = [];
let activeHydrationRequests = 0;
const MAX_CONCURRENT_HYDRATIONS = 4;

function processHydrationQueue() {
    if (activeHydrationRequests >= MAX_CONCURRENT_HYDRATIONS || pendingHydrationQueue.length === 0) {
        return;
    }

    const task = pendingHydrationQueue.shift();
    activeHydrationRequests++;

    task().finally(() => {
        activeHydrationRequests--;
        processHydrationQueue();
    });
}

const hydrationObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const card = entry.target;
            const workflowId = card.dataset.workflowId;
            if (workflowId) {
                const workflow = state.workflowsData.find(w => resolveWorkflowId(w) === workflowId);
                if (workflow && !workflowHasDisplayableMedia(workflow)) {
                    // Queue the hydration instead of firing immediately
                    pendingHydrationQueue.push(() => hydrateWorkflowMedia(workflowId, workflow, card));
                    processHydrationQueue();
                }
            }
            hydrationObserver.unobserve(card);
        }
    });
}, { rootMargin: '200px' }) : null;

function scheduleWorkflowBatch(callback) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(callback);
    } else if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(callback);
    } else {
        setTimeout(callback, 16);
    }
}

function resolveWorkflowId(workflow) {
    if (!workflow || typeof workflow !== 'object') {
        return null;
    }
    if (workflow.id) return String(workflow.id);
    if (workflow.workflowId) return String(workflow.workflowId);
    if (workflow.workflow_id) return String(workflow.workflow_id);
    if (workflow.slug) return String(workflow.slug);
    if (!workflow.__workflowGeneratedId) {
        workflow.__workflowGeneratedId = `workflow-auto-${++workflowIdFallbackCounter}`;
    }
    return workflow.__workflowGeneratedId;
}

function parseTimestamp(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const numeric = Number(trimmed);
        if (!Number.isNaN(numeric)) {
            return numeric;
        }
        const parsed = Date.parse(trimmed);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function getMediaSource(mediaItem) {
    if (!mediaItem || typeof mediaItem !== 'object') {
        return '';
    }

    // 1. Check explicit expiry field if available (preferred)
    const explicitExpires = mediaItem.fileUrlExpiresAt || mediaItem.file_url_expires_at;
    if (explicitExpires) {
        const expiryTime = new Date(explicitExpires).getTime();
        if (!isNaN(expiryTime) && expiryTime < Date.now()) {
            return '';
        }
    }

    const source = (
        mediaItem.fileUrl ||
        mediaItem.file_url ||
        mediaItem.proxyUrl ||
        mediaItem.proxy_url ||
        mediaItem.url ||
        mediaItem.file ||
        ''
    );

    if (!source) return '';

    // 2. Check for S3/presigned URL expiration in the query string
    // Format: ?...&Expires=1234567890&...
    try {
        // Use a dummy base for relative URLs (though these are likely absolute)
        const urlObj = new URL(source, 'http://dummy.com'); 
        const expiresParam = urlObj.searchParams.get('Expires'); // Case-sensitive usually, S3 uses 'Expires' or 'X-Amz-Expires' (relative)
        
        // Standard Expires param (absolute timestamp in seconds)
        if (expiresParam) {
            const expiryTimestamp = parseInt(expiresParam, 10) * 1000;
            const now = Date.now();
            // Add 10-second buffer to be safe
            if (!isNaN(expiryTimestamp) && expiryTimestamp < now + 10000) {
                return '';
            }
        }
    } catch (e) {
        // Ignore URL parsing errors
    }

    return source;
}

function computeWorkflowVersion(workflow) {
    const versionCandidates = WORKFLOW_VERSION_KEYS.map(key => parseTimestamp(workflow[key])).filter(Boolean);
    const timestamp = versionCandidates.length ? Math.max(...versionCandidates) : null;
    const metadataSignature = JSON.stringify({
        name: workflow.name || '',
        description: workflow.description || '',
        preview: !!workflow._previewMode,
        installMessage: workflow.workflowInstallMessage || workflow.installMessage || workflow.install_message || '',
        tags: Array.isArray(workflow.tags) ? workflow.tags.join('|') : '',
        categories: Array.isArray(workflow.categories) ? workflow.categories.join('|') : ''
    });
    return [timestamp ? String(timestamp) : null, metadataSignature].filter(Boolean).join('|') || metadataSignature;
}

function computeMediaSignature(workflow) {
    if (!workflow || !Array.isArray(workflow.media) || workflow.media.length === 0) {
        return 'no-media';
    }
    const normalized = workflow.media
        .filter(Boolean)
        .map(item => {
            if (!item || typeof item !== 'object') {
                return 'empty';
            }
            const source = getMediaSource(item);
            const expiresAt = item.fileUrlExpiresAt || item.file_url_expires_at || '';
            const updated = item.updated_at || item.updatedAt || '';
            const mediaId = item.id || item.key || '';
            return [mediaId, source, expiresAt, updated].filter(Boolean).join('~') || 'media';
        });
    return `${workflow.media.length}:${normalized.join('||')}`;
}

function renderCategoryFilterOptions(categories) {
    const select = document.getElementById('nitra-workflow-category-filter');
    if (!select) return;

    const uniqueCategories = Array.from(new Set(categories.filter(Boolean).map(category => category.trim()))).filter(Boolean).sort((a, b) => a.localeCompare(b));

    const options = ['<option value="all">All Categories</option>'].concat(
        uniqueCategories.map(category => `<option value="${category}">${category}</option>`)
    );

    select.innerHTML = options.join('');

    if (workflowCategoryFilter !== 'all' && !uniqueCategories.includes(workflowCategoryFilter)) {
        workflowCategoryFilter = 'all';
    }

    select.value = workflowCategoryFilter;

    select.onchange = () => {
        workflowCategoryFilter = select.value;
        renderWorkflows();
    };
}

function getWorkflowCreatedTimestamp(workflow) {
    if (!workflow || typeof workflow !== 'object') {
        return 0;
    }
    for (const key of WORKFLOW_CREATED_KEYS) {
        const timestamp = parseTimestamp(workflow[key]);
        if (timestamp !== null) {
            return timestamp;
        }
    }
    return 0;
}

function sortWorkflowsForDisplay(workflows) {
    if (!Array.isArray(workflows)) {
        return [];
    }
    const sorted = workflows.slice();
    if (workflowSortOption === 'date-desc') {
        sorted.sort((a, b) => {
            const diff = getWorkflowCreatedTimestamp(b) - getWorkflowCreatedTimestamp(a);
            if (diff !== 0) {
                return diff;
            }
            return (a.name || '').localeCompare(b.name || '');
        });
    } else {
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return sorted;
}

// Global helpers so inline handlers on cards can control video playback
function renderMediaElement(mediaItem, workflowId, options = {}) {
    // console.log('Nitra: renderMediaElement', workflowId, JSON.stringify(mediaItem).slice(0, 100));
    const { role = 'base', clipPercent = 50 } = options;
    if (!mediaItem) {
        return `
            <div class="workflow-media-placeholder"></div>
        `;
    }

    const source = getMediaSource(mediaItem);
    if (!source) {
        return `
            <div class="workflow-media-placeholder"></div>
        `;
    }

    const isVideo = mediaItem.type === 'video';
    const baseClass = `workflow-media-layer${role === 'overlay' ? ' compare-overlay' : ''}`;
    const overlayAttributes =
        role === 'overlay'
            ? `data-workflow-overlay="${workflowId}" style="clip-path: inset(0 ${100 - clipPercent}% 0 0);"`
            : '';

    if (isVideo) {
        return `
            <video
                class="${baseClass}"
                ${overlayAttributes}
                data-workflow-video="${workflowId}"
                src="${source}"
                muted
                playsinline
                loop
            ></video>
        `;
    }

    return `
        <img
            class="${baseClass}"
            ${overlayAttributes}
            src="${source}"
            alt="Workflow media"
            loading="lazy"
        />
    `;
}

function renderWorkflowMediaArea(workflow, mediaItems) {
    const workflowId = resolveWorkflowId(workflow);
    // Ensure we only try to render items that actually have a source URL
    const validItems = Array.isArray(mediaItems) ? mediaItems.filter(item => getMediaSource(item)) : [];
    
    // console.log('Nitra: renderWorkflowMediaArea processing', workflowId, validItems.length, 'valid items');

    if (!validItems || validItems.length === 0) {
        return `
            <div class="workflow-media-area">
                <div class="workflow-media-placeholder"></div>
            </div>
        `;
    }

    if (validItems.length >= 2) {
        const primary = validItems[0];
        const secondary = validItems[1];
        const initialClip = 50;
        return `
            <div class="workflow-media-area">
                <div
                    class="workflow-media-compare"
                    data-workflow-id="${workflowId}"
                >
                    ${renderMediaElement(secondary, workflowId, { role: 'base' })}
                    ${renderMediaElement(primary, workflowId, { role: 'overlay', clipPercent: initialClip })}
                    <div class="workflow-media-slider-visual" data-workflow-slider-visual="${workflowId}" style="--slider-position: ${initialClip}%;">
                        <div class="workflow-media-slider-line"></div>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value="${initialClip}"
                        class="workflow-media-slider-input"
                        data-workflow-slider="${workflowId}"
                        oninput="nitraAdjustWorkflowSlider('${workflowId}', this.value)"
                        aria-label="Compare workflow media"
                        aria-hidden="true"
                        tabindex="-1"
                    />
                </div>
            </div>
        `;
    }

    return `
        <div class="workflow-media-area">
            ${renderMediaElement(validItems[0], workflowId)}
        </div>
    `;
}

const sliderCache = new Map();
const sliderState = new Map();

function workflowHasDisplayableMedia(workflow) {
    if (!workflow || !Array.isArray(workflow.media)) {
        return false;
    }
    return workflow.media.some(item => item && typeof item === 'object' && getMediaSource(item));
}

function buildWorkflowCardMarkup(workflow) {
    const workflowId = resolveWorkflowId(workflow);
    const isPreview = workflow._previewMode;
    const lockIcon = isPreview ? ' 🔒' : '';
    // Filter media items to ensure they are valid objects
    const mediaItems = Array.isArray(workflow.media) ? workflow.media.filter(item => item && typeof item === 'object') : [];
    const mediaMarkup = renderWorkflowMediaArea(workflow, mediaItems);
    const checkboxAttributes = isPreview ? 'disabled' : 'onclick="event.stopPropagation();"';
    const workflowName = workflow.name || 'Unnamed Workflow';
    const description = workflow.description || 'No description available';

    return `
        <div class="workflow-card" style="
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 0;
            padding: 0;
            border-radius: 18px;
            background: #050505;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 10px 35px rgba(0,0,0,0.55);
            min-height: 260px;
            overflow: hidden;
            transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
            cursor: pointer;
        "
        ${!isPreview ? `onclick="document.getElementById('workflow-${workflowId}').click();"` : ''}
        onmouseover="this.style.boxShadow='0 18px 40px rgba(0,0,0,0.7)'; nitraPlayWorkflowVideo('${workflowId}');"
        onmouseout="this.style.boxShadow='0 10px 35px rgba(0,0,0,0.55)'; nitraPauseWorkflowVideo('${workflowId}');"
        >
            ${mediaMarkup}
            <div style="position:relative; z-index:1; display:flex; flex-direction:column; justify-content:space-between; height:100%; padding:16px 16px 14px 16px; pointer-events:none;">
                <div style="display:flex; align-items:flex-start; justify-content:flex-start; gap:10px; pointer-events:auto;">
                    <label style="display:flex; align-items:center; gap:10px; color:#f9fafb; font-weight:600; cursor:pointer;">
                        <input type="checkbox" id="workflow-${workflowId}" value="${workflowId}" ${checkboxAttributes} style="transform:scale(1.15);">
                        <span style="text-shadow:0 2px 4px rgba(0,0,0,0.9);">${workflowName}${lockIcon}</span>
                    </label>
                </div>
                <div style="margin-top:auto; pointer-events:auto;">
                    <div style="font-size: 0.9em; color: #f9fafb; opacity: 0.92; line-height: 1.6; text-shadow:0 1px 3px rgba(0,0,0,0.9);">
                        ${description}
                    </div>
                    ${isPreview ? `<div style="font-size: 0.8em; color: #fbbf24; font-weight: 600; margin-top:6px; text-shadow:0 1px 3px rgba(0,0,0,0.9);">Subscribe to download</div>` : ''}
                </div>
            </div>
        </div>
    `;
}

function createWorkflowCardElement(workflow) {
    const markup = buildWorkflowCardMarkup(workflow).trim();
    const template = document.createElement('div');
    template.innerHTML = markup;
    return template.firstElementChild;
}

function updateCheckboxForWorkflow(workflowId, workflow) {
    const checkbox = document.getElementById(`workflow-${workflowId}`);
    if (!checkbox || workflow?._previewMode) {
        return;
    }
    checkbox.checked = state.selectedWorkflows.has(workflowId);
    checkbox.onchange = () => {
        if (checkbox.checked) {
            state.selectedWorkflows.add(workflowId);
        } else {
            state.selectedWorkflows.delete(workflowId);
        }
        updateWorkflowInstallButton({ forceWarmModelCache: true });
    };
}

function insertCardAtPosition(container, card, position) {
    if (!container || !card) return;
    const referenceNode = container.children[position] || null;
    container.insertBefore(card, referenceNode);
}

function ensureCardPosition(container, card, targetIndex) {
    if (!container || !card) return;
    const targetNode = container.children[targetIndex];
    if (targetNode === card) {
        return;
    }
    container.insertBefore(card, targetNode || null);
}

function removeStaleWorkflowCards(container, desiredIds) {
    workflowCardCache.forEach((entry, id) => {
        if (!desiredIds.has(id)) {
            if (entry.node && entry.node.parentNode === container) {
                container.removeChild(entry.node);
            }
            workflowCardCache.delete(id);
            sliderCache.delete(id);
            workflowMediaHydration.delete(id); // Cancel pending hydration if removed
        }
    });
}

function clearWorkflowCards(container) {
    workflowCardCache.forEach(entry => {
        if (entry.node && entry.node.parentNode === container) {
            container.removeChild(entry.node);
        }
    });
    workflowCardCache.clear();
    sliderCache.clear();
}

function updateWorkflowsGrid(container, workflows, onComplete) {
    workflowRenderToken += 1;
    const token = workflowRenderToken;
    const desiredIds = new Set();
    workflows.forEach(workflow => {
        const workflowId = resolveWorkflowId(workflow);
        if (workflowId) {
            desiredIds.add(workflowId);
        }
    });

    removeStaleWorkflowCards(container, desiredIds);

    let index = 0;
    const processBatch = () => {
        if (token !== workflowRenderToken) {
            return;
        }
        
        const max = Math.min(index + WORKFLOW_RENDER_BATCH_SIZE, workflows.length);
        
        for (; index < max; index++) {
            const workflow = workflows[index];
            const workflowId = resolveWorkflowId(workflow);
            if (!workflowId) {
                continue;
            }

            const version = computeWorkflowVersion(workflow);
            const mediaSignature = computeMediaSignature(workflow);
            const cached = workflowCardCache.get(workflowId);

            if (cached && cached.version === version && cached.mediaSignature === mediaSignature) {
                ensureCardPosition(container, cached.node, index);
                // Even if cached, check if we need to observe for hydration (if it was somehow reset or missed)
                if (!workflowHasDisplayableMedia(workflow) && hydrationObserver) {
                    hydrationObserver.observe(cached.node);
                }
                continue;
            }

            const cardElement = createWorkflowCardElement(workflow);
            if (!cardElement) {
                continue;
            }
            cardElement.dataset.workflowId = workflowId;

            if (cached && cached.node && cached.node.parentNode === container) {
                container.replaceChild(cardElement, cached.node);
            } else {
                insertCardAtPosition(container, cardElement, index);
            }

            workflowCardCache.set(workflowId, {
                node: cardElement,
                version,
                mediaSignature
            });

            if (!workflowHasDisplayableMedia(workflow)) {
                // Use IntersectionObserver for lazy hydration
                if (hydrationObserver) {
                    hydrationObserver.observe(cardElement);
                } else {
                    // Fallback if no Observer
                    hydrateWorkflowMedia(workflowId, workflow, cardElement);
                }
            } else {
                workflowMediaBuffer.set(workflowId, workflow.media.map(item => ({ ...item })));
            }
        }

        if (index < workflows.length) {
            scheduleWorkflowBatch(processBatch);
        } else if (typeof onComplete === 'function') {
            onComplete(token);
        }
    };

    scheduleWorkflowBatch(processBatch);
}

function syncWorkflowCheckboxStates(workflows) {
    workflows.forEach(workflow => {
        const workflowId = resolveWorkflowId(workflow);
        updateCheckboxForWorkflow(workflowId, workflow);
    });
}

function updateWorkflowUpgradeBanner(inPreviewMode) {
    const upgradeContainer = document.getElementById('nitra-workflows-upgrade');
    if (!upgradeContainer) {
        return;
    }
    if (inPreviewMode) {
        upgradeContainer.innerHTML = `
            <div style="
                background: linear-gradient(135deg, rgba(160, 187, 196, 0.08), rgba(209, 78, 114, 0.12));
                border: 1px solid rgba(160, 187, 196, 0.35);
                border-radius: 10px;
                padding: 14px 16px;
                margin-bottom: 16px;
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:12px;
            ">
                <div style="color:#f9fafb; font-size:13px;">
                    <div style="font-weight:600; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">
                        Unlock Full Workflow Downloads
                    </div>
                    <div style="opacity:0.9;">
                        You can preview every workflow here. Activate your Nitra subscription to download and install them directly into ComfyUI.
                    </div>
                </div>
                <button onclick="window.open('${getWebsiteBaseUrl()}/#pricing', '_blank')" 
                    style="white-space:nowrap; background:#0b0b0b; color:#ffffff; border:1px solid #ffffff; padding:8px 16px; border-radius:8px; cursor:pointer; font-weight:600; font-size:13px;">
                    View Plans
                </button>
            </div>
        `;
    } else {
        upgradeContainer.innerHTML = '';
    }
}

function setupSelectButtons(filteredWorkflows) {
    const selectAllWorkflowsBtn = document.getElementById('nitra-select-all-workflows');
    if (selectAllWorkflowsBtn) {
        selectAllWorkflowsBtn.onclick = () => {
            filteredWorkflows
                .filter(workflow => !workflow._previewMode)
                .forEach(workflow => {
                    const workflowId = resolveWorkflowId(workflow);
                    if (workflowId) {
                        state.selectedWorkflows.add(workflowId);
                    }
                });
            syncWorkflowCheckboxStates(filteredWorkflows);
            updateWorkflowInstallButton({ forceWarmModelCache: true });
        };
    }

    const deselectAllWorkflowsBtn = document.getElementById('nitra-deselect-all-workflows');
    if (deselectAllWorkflowsBtn) {
        deselectAllWorkflowsBtn.onclick = () => {
            if (typeof state.selectedWorkflows.clear === 'function') {
                state.selectedWorkflows.clear();
            } else {
                filteredWorkflows.forEach(workflow => {
                    const workflowId = resolveWorkflowId(workflow);
                    if (workflowId) {
                        state.selectedWorkflows.delete(workflowId);
                    }
                });
            }
            syncWorkflowCheckboxStates(filteredWorkflows);
            updateWorkflowInstallButton({ forceWarmModelCache: true });
        };
    }
}

function showWorkflowsPlaceholder(container, message) {
    if (!container) return;
    clearWorkflowCards(container);
    container.innerHTML = `<div class="nitra-centered-placeholder">${message}</div>`;
}

function clearWorkflowsPlaceholder(container) {
    if (!container) return;
    const placeholders = container.querySelectorAll('.nitra-centered-placeholder');
    placeholders.forEach(el => el.remove());
    
    // Remove any text nodes that contain the loading message, regardless of other children
    Array.from(container.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Loading workflows')) {
            container.removeChild(node);
        }
    });
}

function getSliderElements(workflowId) {
    if (sliderCache.has(workflowId)) {
        const cached = sliderCache.get(workflowId);
        if (cached.container && cached.container.isConnected) {
            return cached;
        }
        sliderCache.delete(workflowId);
    }

    const container = document.querySelector(`.workflow-media-compare[data-workflow-id="${workflowId}"]`);
    if (!container) return null;

    const elements = { 
        container, 
        overlay: container.querySelector(`[data-workflow-overlay="${workflowId}"]`),
        sliderVisual: container.querySelector(`[data-workflow-slider-visual="${workflowId}"]`),
        sliderInput: container.querySelector(`[data-workflow-slider="${workflowId}"]`)
    };
    sliderCache.set(workflowId, elements);
    return elements;
}

function setWorkflowSliderValue(workflowId, rawValue) {
    const valueNumber = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (Number.isNaN(valueNumber)) {
        return;
    }
    const value = Math.max(0, Math.min(100, valueNumber));
    
    const elements = getSliderElements(workflowId);
    if (!elements) return;

    if (elements.overlay) {
        elements.overlay.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    }
    if (elements.sliderVisual) {
        elements.sliderVisual.style.setProperty('--slider-position', `${value}%`);
    }
    if (elements.sliderInput && elements.sliderInput.value !== String(value)) {
        elements.sliderInput.value = String(value);
    }
}

function attachWorkflowMediaCompareListeners() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return;
    }
    const containers = document.querySelectorAll('.workflow-media-compare[data-workflow-id]');
    containers.forEach(container => {
        if (!container || !(container instanceof HTMLElement)) {
            return;
        }
        if (container.dataset.nitraSliderAttached === 'true') {
            return;
        }
        const workflowId = container.getAttribute('data-workflow-id');
        if (!workflowId) {
            return;
        }
        const mouseHandler = event => {
            event.stopPropagation();
            if (window.nitraHoverWorkflowSlider) {
                window.nitraHoverWorkflowSlider(event, workflowId);
            }
        };
        const touchHandler = event => {
            event.stopPropagation();
            if (window.nitraHoverWorkflowSlider) {
                window.nitraHoverWorkflowSlider(event, workflowId);
            }
        };
        container.addEventListener('mousemove', mouseHandler);
        container.addEventListener('mouseenter', mouseHandler);
        container.addEventListener('touchstart', touchHandler, { passive: false });
        container.addEventListener('touchmove', touchHandler, { passive: false });
        container.dataset.nitraSliderAttached = 'true';
    });
}

if (typeof window !== 'undefined') {
    window.nitraPlayWorkflowVideo = function (workflowId) {
        try {
            const videos = document.querySelectorAll(`[data-workflow-video="${workflowId}"]`);
            videos.forEach(video => {
                if (video && video.paused) {
                    video.play().catch(() => {});
                }
            });
        } catch (e) {
            console.warn('Nitra: failed to play workflow video', e);
        }
    };

    window.nitraPauseWorkflowVideo = function (workflowId) {
        try {
            const videos = document.querySelectorAll(`[data-workflow-video="${workflowId}"]`);
            videos.forEach(video => {
                if (video && !video.paused) {
                    video.pause();
                    video.currentTime = 0;
                }
            });
        } catch (e) {
            console.warn('Nitra: failed to pause workflow video', e);
        }
    };

    window.nitraAdjustWorkflowSlider = function (workflowId, value) {
        setWorkflowSliderValue(workflowId, value);
    };

    window.nitraHoverWorkflowSlider = function (event, workflowId) {
        if (event && typeof event.preventDefault === 'function' && event.type && event.type.startsWith('touch')) {
            event.preventDefault();
        }

        let clientX;
        if (event && typeof event === 'object' && 'touches' in event) {
            const touch = event.touches[0];
            if (touch) clientX = touch.clientX;
        } else if (event) {
            clientX = event.clientX;
        }

        if (typeof clientX !== 'number') return;

        let state = sliderState.get(workflowId);
        if (!state) {
            state = { rafId: null, clientX: 0 };
            sliderState.set(workflowId, state);
        }
        
        state.clientX = clientX;

        if (!state.rafId) {
            state.rafId = requestAnimationFrame(() => {
                state.rafId = null;
                
                const elements = getSliderElements(workflowId);
                if (!elements) return;

                const rect = elements.container.getBoundingClientRect();
                if (!rect.width) return;

                const percent = ((state.clientX - rect.left) / rect.width) * 100;
                setWorkflowSliderValue(workflowId, percent);
            });
        }
    };
}

export function renderWorkflows() {
    const workflowsList = document.getElementById('nitra-workflows-list');
    if (!workflowsList) return;

    if (typeof state.hydrateWorkflowsFromCache === 'function') {
        state.hydrateWorkflowsFromCache();
    }

    // Check for license/cache mismatch to prevent showing locked content to paid users
    if (state.currentLicenseStatus) {
        const hasSubscription = state.currentLicenseStatus.has_paid_subscription || state.currentLicenseStatus.status === 'paid';
        const cacheInfo = typeof state.getWorkflowsCacheInfo === 'function' ? state.getWorkflowsCacheInfo() : null;
        
        if (hasSubscription && cacheInfo && cacheInfo.mode === 'preview') {
            if (workflowsList) workflowsList.innerHTML = '';
            return;
        }
    }
    
    // Ensure workflowsData is an array
    if (!Array.isArray(state.workflowsData)) {
        return;
    }
    
    if (state.workflowsData.length === 0) {
        // If the placeholder is still "Loading...", don't clear it yet.
        // We only clear if we are sure we loaded (which should happen when renderWorkflows is called after fetch).
        // However, renderWorkflows clears innerHTML by default on empty list.
        // We need to differentiate "empty because loading" vs "empty because no results".
        
        // Check if the current content is the initial loading placeholder
        const currentHTML = workflowsList.innerHTML;
        if (currentHTML.includes('Loading workflows')) {
            // Do not clear if we might still be loading.
            // But how do we know?
            // If this render call came from `loadWorkflows().then()`, we should clear.
            // If it came from initial render pass with empty cache, we should NOT clear.
            
            // For now, we rely on the fact that updateInterface.js only calls renderWorkflows
            // if cache exists OR after load completes.
            // So if we are here, it means either we have data (caught above) OR we finished loading and have 0 items.
            // BUT, there are other triggers for renderWorkflows (search, filter).
            
            // If we are here, workflowsData is empty.
            // If cache was empty, updateInterface skipped the initial render call.
            // So we must be here after a load completed or a filter was applied.
            // Therefore, it IS correct to clear the "Loading..." message now.
        }

        if (workflowsList) workflowsList.innerHTML = '';
        updateWorkflowUpgradeBanner(false);
        updateWorkflowInstallButton();
        return;
    }
    
    const rawSearch = document.getElementById('nitra-workflow-search')?.value || '';
    const searchTerm = rawSearch.toLowerCase().trim();

    const allCategories = Array.from(new Set(state.workflowsData
        .flatMap(workflow => Array.isArray(workflow.categories) ? workflow.categories : [])
        .filter(category => typeof category === 'string' && category.trim())
    )).sort((a, b) => a.localeCompare(b));
    renderCategoryFilterOptions(allCategories);
    const sortSelect = document.getElementById('nitra-workflow-sort');
    if (sortSelect) {
        if (sortSelect.value !== workflowSortOption) {
            sortSelect.value = workflowSortOption;
        }
        if (!sortSelect.dataset.bound) {
            sortSelect.dataset.bound = 'true';
            sortSelect.addEventListener('change', () => {
                workflowSortOption = sortSelect.value || 'name-asc';
                renderWorkflows();
            });
        }
    }

    const searchedWorkflows = state.workflowsData.filter(workflow => {
        if (!searchTerm) return true;

        const nameMatch = (workflow.name || '').toLowerCase().includes(searchTerm);
        const descriptionMatch = (workflow.description || '').toLowerCase().includes(searchTerm);
        const tagMatch = Array.isArray(workflow.tags)
            ? workflow.tags.some(tag => (tag || '').toLowerCase().includes(searchTerm))
            : false;

        return nameMatch || descriptionMatch || tagMatch;
    });

    const filteredWorkflows = workflowCategoryFilter === 'all'
        ? searchedWorkflows
        : searchedWorkflows.filter(workflow =>
            Array.isArray(workflow.categories)
                ? workflow.categories.some(category => category === workflowCategoryFilter)
                : false
    );
    const workflowsForDisplay = sortWorkflowsForDisplay(filteredWorkflows);
    if (state.selectedWorkflows.size > 0) {
        updateWorkflowInstallButton({ forceWarmModelCache: true });
    }
    
    // Check if any workflows are in preview mode
    const inPreviewMode = filteredWorkflows.some(w => w._previewMode);

    if (!workflowsForDisplay.length) {
        showWorkflowsPlaceholder(workflowsList, 'No workflows match your filters.');
        updateWorkflowUpgradeBanner(false);
        updateWorkflowInstallButton();
        return;
    }
    
    workflowsList.style.display = 'grid';
    workflowsList.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    workflowsList.style.gap = '18px';
    workflowsList.style.padding = '12px 0';
    workflowsList.style.margin = '0';
    
    clearWorkflowsPlaceholder(workflowsList);
    updateWorkflowsGrid(workflowsList, workflowsForDisplay, (token) => {
        if (token !== workflowRenderToken) {
            return;
        }
        attachWorkflowMediaCompareListeners();
        syncWorkflowCheckboxStates(workflowsForDisplay);
        updateWorkflowUpgradeBanner(inPreviewMode);
        updateWorkflowInstallButton();
    });
    
    // Add search functionality
    const searchInput = document.getElementById('nitra-workflow-search');
    if (searchInput) {
        searchInput.oninput = () => {
            renderWorkflows();
            updateWorkflowInstallButton();
        };
    }
    
    setupSelectButtons(workflowsForDisplay);
    restoreBufferedMedia();
}

async function hydrateWorkflowMedia(workflowId, workflow, cardElement) {
    if (!workflowId || workflowMediaHydration.has(workflowId)) {
        return;
    }
    const hydrationPromise = (async () => {
        try {
            // console.debug('Nitra: Starting hydration for workflow', workflowId);
            // Force refresh from server to get fresh presigned URLs
            const details = await fetchWorkflowDetails(workflowId, { refresh: true, mediaOnly: true });
            
            if (!details) {
                // console.warn('Nitra: Hydration failed - No details returned for', workflowId);
                return;
            }

            // console.debug('Nitra: Fetched details for hydration', workflowId, details.media);

            if (!workflowHasDisplayableMedia(details)) {
                // console.warn('Nitra: Hydrated details still have no displayable media for', workflowId);
                return;
            }

            const updatedWorkflow = {
                ...workflow,
                ...details,
            };

            const newCard = createWorkflowCardElement(updatedWorkflow);
            if (!newCard) {
                return;
            }

            // If the element was removed from DOM in the meantime, don't re-insert unless it's just disconnected (e.g. tab switch)
            // But we must update the cache node reference so future renders use the new card
            if (cardElement && cardElement.parentNode) {
                cardElement.replaceWith(newCard);
            } else if (cardElement) {
                // If old card is detached, we still want to update the cache so next time it's attached it has media
                // The grid updater will pull from cache
            }

            // Update the cache immediately so next render cycle picks up the full card
            workflowCardCache.set(workflowId, {
                node: newCard,
                version: computeWorkflowVersion(updatedWorkflow),
                mediaSignature: computeMediaSignature(updatedWorkflow),
            });

            const list = state.workflowsData;
            if (Array.isArray(list)) {
                const idx = list.findIndex(item => resolveWorkflowId(item) === workflowId);
                if (idx >= 0) {
                    // Update state.workflowsData in place to persist the hydration
                    state.workflowsData[idx] = {
                        ...list[idx],
                        ...details,
                    };
                    // Ensure the main state store is updated so if a re-render happens from scratch it uses this
                    state.setWorkflowsData(state.workflowsData, { mode: state.getWorkflowsCacheInfo().mode });
                }
            }
            workflowMediaBuffer.set(workflowId, updatedWorkflow.media.map(item => ({ ...item })));

            attachWorkflowMediaCompareListeners();
            updateCheckboxForWorkflow(workflowId, updatedWorkflow);
        } catch (error) {
            console.warn('Nitra: Failed to hydrate workflow media', workflowId, error);
        } finally {
            workflowMediaHydration.delete(workflowId);
        }
    })();

    workflowMediaHydration.set(workflowId, hydrationPromise);
}

function restoreBufferedMedia() {
    if (!Array.isArray(state.workflowsData)) {
        return;
    }
    state.workflowsData.forEach((workflow, index) => {
        const workflowId = resolveWorkflowId(workflow);
        if (!workflowId) {
            return;
        }
        if (workflowHasDisplayableMedia(workflow)) {
            return;
        }
        const bufferedMedia = workflowMediaBuffer.get(workflowId);
        if (!bufferedMedia || !bufferedMedia.length) {
            return;
        }
        const updatedWorkflow = {
            ...workflow,
            media: bufferedMedia.map(item => ({ ...item })),
        };
        state.workflowsData[index] = updatedWorkflow;
        const cacheEntry = workflowCardCache.get(workflowId);
        if (cacheEntry) {
            cacheEntry.version = computeWorkflowVersion(updatedWorkflow);
            cacheEntry.mediaSignature = computeMediaSignature(updatedWorkflow);
        }
    });
}










