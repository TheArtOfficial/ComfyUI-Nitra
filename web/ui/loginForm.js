/**
 * Login form component (REFACTORED with component library)
 * Clean version using nitra components
 */

import { div, h2, h3, p, ul, li, svg, path, img, span } from './components/core.js';
import { Button } from './components/Button.js';
import { loginWithWebsite } from '../auth/oauth.js';

export function createLoginForm() {
    // Status message container
    const statusEl = div({
        id: 'nitra-login-status',
        style: {
            textAlign: 'center',
            fontSize: '0.9em',
            padding: '12px',
            borderRadius: '8px',
            display: 'none',
            marginTop: '20px'
        }
    });
    
    // Login button with icon
    const loginIcon = svg(
        { width: "20", height: "20", viewBox: "0 0 24 24", fill: "currentColor" },
        path({ d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" })
    );
    
    const loginBtn = Button({
        id: 'nitra-auth0-login-btn',
        text: 'Continue with Login',
        onClick: () => handleLogin(statusEl),
        variant: 'primary',
        large: true,
        icon: loginIcon
    });
    loginBtn.style.width = '100%';
    loginBtn.style.maxWidth = '360px';
    loginBtn.style.borderRadius = '10px';
    loginBtn.style.fontSize = '1.1em';
    loginBtn.style.justifyContent = 'center';
    loginBtn.style.padding = '16px 24px';
    
    const loginBtnContainer = div(
        {
            className: 'nitra-btn-container-center',
            style: {
                width: '100%',
                display: 'flex',
                justifyContent: 'center'
            }
        },
        loginBtn
    );
    
    const logoPath = 'extensions/ComfyUI-Nitra/images/HorizontalNitraBlack.png';
    const resolvedLogo = window?.app?.ui?.getFileUrl
        ? window.app.ui.getFileUrl(logoPath) || logoPath
        : logoPath;
    
    const header = div(
        { style: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' } },
        div(
            { style: { display: 'flex', alignItems: 'flex-end', gap: '12px', justifyContent: 'center' } },
            span(
                { style: { color: '#ffffff', margin: 0, fontSize: '2.2em', letterSpacing: '0.08em', fontWeight: '700' } },
                'Welcome to '
            ),
            img({
                src: resolvedLogo,
                alt: 'nitra',
                style: {
                    height: '4.5em',
                    width: 'auto',
                    verticalAlign: 'middle',
                    display: 'block',
                    marginBottom: '-6.6px',
                    marginTop: '-6.6px'
                }
            })
        )
    );
    
    const featuresSection = div(
        {
            style: {
                width: '100%',
                maxWidth: '360px',
                background: 'transparent',
                marginTop: '-6px',
                textAlign: 'center'
            }
        },
            h3(
            { style: { margin: '0 0 0 0', fontSize: '0.95em', letterSpacing: '0.05em', color: '#d8d8d8', fontWeight: 'normal' } },
            'Authentication handled securely by Auth0'
            )
    );
    
    return div(
        { 
            className: 'nitra-login-form',
            style: {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '28px',
                textAlign: 'center'
            }
        },
        header,
        loginBtnContainer,
        featuresSection,
        statusEl
    );
}

async function handleLogin(statusEl) {
    console.log('Nitra: Login button clicked!');
    
    statusEl.style.display = 'block';
    statusEl.textContent = 'Redirecting to authentication...';
    statusEl.style.background = '#A0BBC4';
    statusEl.style.color = 'white';
    
    try {
        const result = await loginWithWebsite();
        
        if (result) {
            statusEl.textContent = 'Redirecting to authentication...';
            statusEl.style.background = '#4CAF50';
            statusEl.style.color = 'white';
        } else {
            throw new Error('Login failed');
        }
        
    } catch (error) {
        console.error('Nitra: Login button error:', error);
        statusEl.textContent = `Authentication failed: ${error.message}`;
        statusEl.style.background = '#f44336';
        statusEl.style.color = 'white';
    }
}

