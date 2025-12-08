/**
 * Normalizes a string for comparison (trim + lowercase)
 */
const normalize = (value) => value.trim().toLowerCase();

/**
 * Helper to get the repo URL from a node object, checking common fields
 */
function getRepoUrl(node) {
    return node.gitRepo || node.git_url || node.url || node.reference || '';
}

/**
 * Derive aux_id from repo URL (logic from ComfyUI-Manager)
 */
function deriveAuxId(repoUrl) {
    if (!repoUrl) return null;
    repoUrl = repoUrl.replace(/\.git$/, '').replace(/\/$/, ''); // Normalize
    if (repoUrl.includes('github.com')) {
        return repoUrl.split('/').slice(-2).join('/');
    }
    // Fallback for other URLs or partials
    const parts = repoUrl.split('/');
    return parts[parts.length - 1];
}

/**
 * Calculates similarity between two strings (0.0 to 1.0)
 */
function calculateSimilarity(str1, str2) {
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const bigrams1 = new Set();
    for (let i = 0; i < s1.length - 1; i++) {
        bigrams1.add(s1.substring(i, i + 2));
    }

    let intersection = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        const bigram = s2.substring(i, i + 2);
        if (bigrams1.has(bigram)) {
            intersection++;
        }
    }

    return (2.0 * intersection) / (s1.length + s2.length - 2);
}

export function matchCustomNodes(detectedIds, detectedCnrIds = [], detectedAuxIds = [], availableNodes, installedNodeTypes = new Set(), nodeMappings = {}) {
    const matches = [];
    const missing = [];
    const seenPacks = new Set(); // Deduplicate packs

    // 1. Process explicit CNR IDs (most reliable)
    detectedCnrIds.forEach(cnrId => {
        const normalizedCnr = normalize(cnrId);
        
        const match = availableNodes.find(node => {
            if (node.id && normalize(node.id) === normalizedCnr) return true;
            if (node.name && normalize(node.name) === normalizedCnr) return true;
            return false;
        });

        if (match) {
            const nodeUrl = getRepoUrl(match);
            const packId = match.id || nodeUrl;

            if (!seenPacks.has(packId)) {
                seenPacks.add(packId);
                matches.push({ 
                    ...match, 
                    gitRepo: nodeUrl, 
                    detectedName: cnrId,
                    isInstalled: false, // Will be updated by node check
                    matchSource: 'cnr_id'
                });
            }
        }
    });

    // 2. Process Aux IDs (Secondary method, common for GitHub repos)
    // Build map of derived aux_id -> node for fast lookup
    const auxIdToNodeMap = new Map();
    availableNodes.forEach(node => {
        const repoUrl = getRepoUrl(node);
        if (repoUrl) {
            const auxId = deriveAuxId(repoUrl);
            if (auxId) {
                // We use normalized keys for safer matching
                auxIdToNodeMap.set(normalize(auxId), node);
            }
        }
    });

    detectedAuxIds.forEach(auxId => {
        const normAuxId = normalize(auxId);
        if (auxIdToNodeMap.has(normAuxId)) {
            const match = auxIdToNodeMap.get(normAuxId);
            const nodeUrl = getRepoUrl(match);
            const packId = match.id || nodeUrl;

            if (!seenPacks.has(packId)) {
                seenPacks.add(packId);
                matches.push({
                    ...match,
                    gitRepo: nodeUrl,
                    detectedName: auxId,
                    isInstalled: false, // Will be updated by node check
                    matchSource: 'aux_id'
                });
            }
        }
    });

    // 3. Process Node Types (Legacy/Standard method)
    // Pre-build a map of NodeType -> Set(PackURLs) for faster lookup
    const nodeTypeToPackUrls = new Map();
    Object.entries(nodeMappings).forEach(([url, nodeTypes]) => {
        if (Array.isArray(nodeTypes)) {
            nodeTypes.forEach(type => {
                if (typeof type === 'string') {
                    const normType = normalize(type);
                    if (!nodeTypeToPackUrls.has(normType)) {
                        nodeTypeToPackUrls.set(normType, new Set());
                    }
                    nodeTypeToPackUrls.get(normType).add(url);
                }
            });
        }
    });

    detectedIds.forEach(id => {
        const normalizedId = normalize(id);
        const isInstalled = installedNodeTypes.has(id);
        
        let matchedPackUrl = null;
        if (nodeTypeToPackUrls.has(normalizedId)) {
            const packs = nodeTypeToPackUrls.get(normalizedId);
            if (packs.size > 0) {
                for (const pUrl of packs) {
                    matchedPackUrl = pUrl;
                    break; 
                }
            }
        }

        const match = availableNodes.find(node => {
            if (!node) return false;
            const nodeUrl = getRepoUrl(node);
            
            if (matchedPackUrl && nodeUrl) {
                const repoA = nodeUrl.replace(/\.git$/, '').replace(/^https?:\/\//, '').toLowerCase();
                const repoB = matchedPackUrl.replace(/\.git$/, '').replace(/^https?:\/\//, '').toLowerCase();
                if (repoA === repoB || repoA.endsWith(repoB) || repoB.endsWith(repoA)) {
                    return true;
                }
            }

            if (node.name && normalize(node.name) === normalizedId) return true;
            
            if (nodeUrl) {
                const repo = nodeUrl.replace(/\.git$/, '').replace(/^https?:\/\//, '');
                const parts = repo.split('/').filter(Boolean);
                return normalize(parts[parts.length - 1]) === normalizedId;
            }
            return false;
        });

        if (match) {
            const nodeUrl = getRepoUrl(match);
            const packId = match.id || nodeUrl;
            
            if (seenPacks.has(packId)) {
                if (isInstalled) {
                    const existing = matches.find(m => (m.id || getRepoUrl(m)) === packId);
                    if (existing) existing.isInstalled = true;
                }
            } else {
                seenPacks.add(packId);
                matches.push({ 
                    ...match, 
                    gitRepo: nodeUrl, 
                    detectedName: id,
                    isInstalled: isInstalled,
                    matchSource: 'node_type'
                });
            }
        } else {
            if (!isInstalled) {
                if (!nodeTypeToPackUrls.has(normalizedId)) {
                     missing.push({ name: id });
                }
            }
        }
    });

    return { matches, missing };
}

export function matchModels(detectedFiles, availableModels, installedModelIds = new Set(), threshold = 0.8) {
    const matches = [];
    const missing = [];

    detectedFiles.forEach(filename => {
        let bestMatch = null;
        let bestScore = 0;

        const exactMatch = availableModels.find(m => m.modelName === filename);
        if (exactMatch) {
            matches.push({ 
                ...exactMatch, 
                matchType: 'Exact', 
                score: 1.0, 
                detectedName: filename,
                isInstalled: installedModelIds.has(exactMatch.id),
                hfTokenRequired: exactMatch.hfTokenRequired
            });
            return;
        }

        availableModels.forEach(model => {
            if (!model.modelName) return;
            
            const score = calculateSimilarity(filename, model.modelName);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = model;
            }
        });

        if (bestMatch && bestScore >= threshold) {
            matches.push({ 
                ...bestMatch, 
                matchType: 'Similar', 
                score: bestScore,
                detectedName: filename,
                isInstalled: installedModelIds.has(bestMatch.id),
                hfTokenRequired: bestMatch.hfTokenRequired
            });
        } else {
            missing.push({ name: filename });
        }
    });

    return { matches, missing };
}
