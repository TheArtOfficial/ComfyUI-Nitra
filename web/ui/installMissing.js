import * as state from '../core/state.js';
console.log("Nitra: installMissing.js module loaded");
import { div, button, input, label, span } from './components/core.js';
import { ListItem } from './components/ListItem.js';
import { getCurrentWorkflowDependencies } from '../workflows/analyzer.js';
import { matchCustomNodes, matchModels } from '../core/matcher.js';
import { fetchCustomNodesLibrary, fetchNodeMappings } from '../customNodes/api.js';
import { getExistingModels } from '../workflows/api.js';
import { showHuggingFaceTokenPrompt } from './systemPrompts.js';

// Track selections
const selectedInstallItems = {
    nodes: new Set(),
    models: new Set()
};

let matchedModelsCache = [];

export async function renderInstallMissing(container) {
    console.log("Nitra: renderInstallMissing called");
    try {
        // reset selections each render
    selectedInstallItems.nodes.clear();
    selectedInstallItems.models.clear();
    matchedModelsCache = [];

    container.innerHTML = '<div style="padding: 20px; color: #bdbdbd;">Analyzing workflow...</div>';

    // 1) Gather data
    console.log("InstallMissing: Starting analysis...");
    const { customNodes, cnrIds, auxIds, models } = getCurrentWorkflowDependencies();
    console.log("InstallMissing: Dependencies found:", { customNodes, cnrIds, auxIds, models });

    const availableNodes = await fetchCustomNodesLibrary();
    console.log("InstallMissing: Available nodes fetched:", availableNodes.length);
    if (availableNodes.length > 0) {
        console.log("InstallMissing: Sample available node:", availableNodes[0]);
    }

    // Fetch mappings to resolve specific node types to packs
    const nodeMappings = await fetchNodeMappings();
    const mappingKeys = Object.keys(nodeMappings);
    console.log("InstallMissing: Node mappings fetched:", mappingKeys.length);

    const availableModels = state.modelsData || [];
    console.log("InstallMissing: Available models in state:", availableModels.length);

    const installedModelIds = await getExistingModels();
    console.log("InstallMissing: Installed models count:", installedModelIds.size || installedModelIds.length);

    // Get currently installed node types to check against
    const installedNodeTypes = new Set(Object.values(LiteGraph.registered_node_types || {}).map(t => t.type));
    console.log("InstallMissing: Installed node types count:", installedNodeTypes.size);

    const nodeResults = matchCustomNodes(customNodes, cnrIds, auxIds, availableNodes, installedNodeTypes, nodeMappings);
    console.log("InstallMissing: Node matching results:", nodeResults);

    const modelResults = matchModels(models, availableModels, installedModelIds);
    console.log("InstallMissing: Model matching results:", modelResults);

    matchedModelsCache = modelResults.matches;

    // 2) Build layout
    container.innerHTML = '';
    container.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; overflow:hidden;';

    const contentArea = div({
        style: {
            display: 'flex',
            flex: 1,
            overflow: 'hidden',
            gap: '20px',
            padding: '20px'
        }
    });

    const createColumn = (title, items, type) => {
        const col = div({
            style: {
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.1)',
                overflow: 'hidden'
            }
        });

        col.appendChild(div({
            style: {
                padding: '16px',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                fontWeight: '600',
                color: '#fff',
                background: 'rgba(0,0,0,0.2)'
            }
        }, `${title} (${items.length})`));

        const listContainer = div({
            style: {
                flex: 1,
                overflowY: 'auto',
                padding: '8px'
            }
        });

        if (items.length === 0) {
            listContainer.appendChild(div({
                style: { padding: '20px', textAlign: 'center', color: '#666' }
            }, "None detected"));
        } else {
            items.forEach(item => {
                const isInstalled = item.isInstalled;

                // Default select missing items
                if (!isInstalled) {
                    type === 'nodes' ? selectedInstallItems.nodes.add(item.id) : selectedInstallItems.models.add(item.id);
                }

                // Format display text per user request: Big Name + % Match
                let rightText = '';
                if (type === 'nodes') {
                     // Custom nodes matched by ID are 100% matches
                     rightText = isInstalled ? 'Installed' : '100%';
                } else {
                     // Models
                     if (isInstalled) {
                         rightText = 'Installed';
                     } else {
                         const score = item.score !== undefined ? item.score : 1.0;
                         rightText = `${Math.round(score * 100)}%`;
                     }
                     
                     if (item.hfTokenRequired) {
                        rightText += ' 🔒';
                     }
                }

                const li = ListItem({
                    id: `${type}-${item.id}`,
                    title: item.name || item.modelName,
                    description: null, // Hide description for cleaner look
                    meta: null,        // Hide meta for cleaner look
                    rightContent: rightText,
                    checked: !isInstalled, // Checked by default if missing
                    disabled: isInstalled, // Disable if already installed
                    onChange: (checked) => {
                        if (isInstalled) return;
                        if (checked) {
                            type === 'nodes' ? selectedInstallItems.nodes.add(item.id) : selectedInstallItems.models.add(item.id);
                        } else {
                            type === 'nodes' ? selectedInstallItems.nodes.delete(item.id) : selectedInstallItems.models.delete(item.id);
                        }
                        updateInstallButton();
                        updateTokenVisibility();
                    }
                });
                listContainer.appendChild(li);
            });
        }

        col.appendChild(listContainer);
        return col;
    };

    contentArea.appendChild(createColumn("Missing Custom Nodes", nodeResults.matches, 'nodes'));
    contentArea.appendChild(createColumn("Missing Models", modelResults.matches, 'models'));
    container.appendChild(contentArea);

    // 3) Footer with HF token
    const footer = div({
        style: {
            padding: '20px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            background: '#0b0b0b',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
        }
    });

    const hfTokenContainer = div({
        id: 'nitra-install-missing-hf-container',
        style: {
            display: 'none',
            padding: '12px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '8px',
            marginBottom: '8px'
        }
    });

    const tokenInput = input({
        type: 'password',
        placeholder: 'hf_...',
        className: 'nitra-input',
        style: { width: '100%', marginTop: '8px' }
    });

    // Prefill token from user-config
    fetch('/nitra/user-config')
        .then(r => r.ok ? r.json() : null)
        .then(cfg => {
            if (cfg?.huggingface_token) tokenInput.value = cfg.huggingface_token;
        })
        .catch(() => {});

    hfTokenContainer.appendChild(div({
        style: { fontSize: '0.9em', color: '#e5e7eb', marginBottom: '4px' }
    }, 'Some selected models require a Hugging Face Access Token.'));
    hfTokenContainer.appendChild(tokenInput);
    footer.appendChild(hfTokenContainer);

    const actionRow = div({
        style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }
    });

    const installBtn = button({
        className: 'nitra-btn nitra-btn-primary',
        style: { padding: '12px 24px', fontSize: '1.1em' },
        onclick: () => handleInstall()
    }, "Install Selected");

    actionRow.appendChild(installBtn);
    footer.appendChild(actionRow);
    container.appendChild(footer);

    // Helpers
    const updateTokenVisibility = () => {
        const selectedModelIds = selectedInstallItems.models;
        const needsToken = matchedModelsCache.some(m => selectedModelIds.has(m.id) && m.hfTokenRequired);
        hfTokenContainer.style.display = needsToken ? 'block' : 'none';
        return needsToken;
    };

    const updateInstallButton = () => {
        const count = selectedInstallItems.nodes.size + selectedInstallItems.models.size;
        installBtn.textContent = `Install Selected (${count})`;
        installBtn.disabled = count === 0;
        installBtn.style.opacity = count === 0 ? '0.5' : '1';
    };

    const handleInstall = async () => {
        if (installBtn.disabled) return;

        const needsToken = updateTokenVisibility();
        const tokenValue = tokenInput.value.trim();
        if (needsToken && !tokenValue) {
            showHuggingFaceTokenPrompt({ context: 'model' });
            return;
        }

        installBtn.textContent = "Installing...";
        installBtn.disabled = true;

        try {
            const modelsToInstall = matchedModelsCache
                .filter(m => selectedInstallItems.models.has(m.id) && !m.isInstalled)
                .map(m => ({
                    id: m.id,
                    name: m.modelName || m.name,
                    url: m.url,
                    hf_token_required: m.hfTokenRequired
                }));

            const nodesToInstall = nodeResults.matches
                .filter(n => selectedInstallItems.nodes.has(n.id))
                .map(n => ({
                    id: n.id,
                    name: n.name,
                    url: n.gitRepo // matcher.js now ensures this is populated from any available URL field
                }));

            const payload = {
                user_id: state.currentUser?.id,
                user_email: state.currentUser?.email,
                options: {
                    workflows: [],
                    subgraphs: [],
                    models: modelsToInstall,
                    custom_nodes: nodesToInstall,
                    huggingface_token: tokenValue || undefined
                },
                script_filename: 'workflow_downloader.py'
            };

            const response = await fetch('/nitra/execute/comfy_setup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.currentUser?.apiToken || ''}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`Request failed: ${response.status}`);

            alert("Installation started! Monitor terminal/logs for progress.");
        } catch (e) {
            console.error(e);
            alert("Installation failed to start. Check console/logs.");
            installBtn.disabled = false;
            updateInstallButton();
        }
    };

    // initial UI state
    updateInstallButton();
    updateTokenVisibility();
    } catch (err) {
        console.error("Nitra: Critical error in renderInstallMissing:", err);
        container.innerHTML = `<div style="padding:20px; color:red;">Error loading tab: ${err.message}</div>`;
    }
}
